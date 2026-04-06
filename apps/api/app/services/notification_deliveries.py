from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.notifications import (
    NotificationDeliveryBulkActionFailure,
    NotificationDeliveryBulkRetryRequest,
    NotificationDeliveryBulkRetryResult,
    NotificationDeliveryRead,
)


def get_my_notification_deliveries(current_user: CurrentUser) -> list[NotificationDeliveryRead]:
    supabase = get_supabase_client()

    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
                "recipient_user_id": f"eq.{current_user.id}",
                "order": "created_at.desc",
                "limit": "50",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [NotificationDeliveryRead(**row) for row in rows]


def get_admin_notification_deliveries() -> list[NotificationDeliveryRead]:
    supabase = get_supabase_client()

    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
                "order": "created_at.desc",
                "limit": "100",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [NotificationDeliveryRead(**row) for row in rows]


def retry_admin_notification_delivery(delivery_id: str) -> NotificationDeliveryRead:
    supabase = get_supabase_client()

    try:
        delivery = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
                "id": f"eq.{delivery_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification delivery not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if delivery["delivery_status"] not in {"failed", "queued"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only failed or queued notification deliveries can be retried",
        )

    try:
        rows = supabase.update(
            "notification_deliveries",
            {
                "delivery_status": "queued",
                "failure_reason": None,
                "next_attempt_at": datetime.now(timezone.utc).isoformat(),
            },
            query={
                "id": f"eq.{delivery_id}",
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification delivery not found")

    return NotificationDeliveryRead(**rows[0])


def _validate_admin_notification_delivery_retry(delivery_id: str) -> None:
    supabase = get_supabase_client()

    try:
        delivery = supabase.select(
            "notification_deliveries",
            query={
                "select": "id,delivery_status",
                "id": f"eq.{delivery_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification delivery not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if delivery["delivery_status"] not in {"failed", "queued"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only failed or queued notification deliveries can be retried",
        )


def retry_my_notification_delivery(
    current_user: CurrentUser,
    delivery_id: str,
) -> NotificationDeliveryRead:
    supabase = get_supabase_client()

    try:
        delivery = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
                "id": f"eq.{delivery_id}",
                "recipient_user_id": f"eq.{current_user.id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification delivery not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if delivery["delivery_status"] not in {"failed", "queued"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only failed or queued notification deliveries can be retried",
        )

    try:
        rows = supabase.update(
            "notification_deliveries",
            {
                "delivery_status": "queued",
                "failure_reason": None,
                "next_attempt_at": datetime.now(timezone.utc).isoformat(),
            },
            query={
                "id": f"eq.{delivery_id}",
                "recipient_user_id": f"eq.{current_user.id}",
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification delivery not found")

    return NotificationDeliveryRead(**rows[0])


def _validate_notification_delivery_retry(
    current_user: CurrentUser,
    delivery_id: str,
) -> None:
    supabase = get_supabase_client()

    try:
        delivery = supabase.select(
            "notification_deliveries",
            query={
                "select": "id,delivery_status",
                "id": f"eq.{delivery_id}",
                "recipient_user_id": f"eq.{current_user.id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification delivery not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if delivery["delivery_status"] not in {"failed", "queued"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only failed or queued notification deliveries can be retried",
        )


def retry_my_notification_deliveries(
    current_user: CurrentUser,
    payload: NotificationDeliveryBulkRetryRequest,
) -> NotificationDeliveryBulkRetryResult:
    succeeded_ids: list[str] = []
    failed: list[NotificationDeliveryBulkActionFailure] = []
    atomic_mode = payload.execution_mode == "atomic"

    if atomic_mode:
        preflight_failures: list[NotificationDeliveryBulkActionFailure] = []
        for delivery_id in payload.delivery_ids:
            try:
                _validate_notification_delivery_retry(current_user, delivery_id)
            except HTTPException as exc:
                preflight_failures.append(
                    NotificationDeliveryBulkActionFailure(id=delivery_id, detail=str(exc.detail)),
                )

        if preflight_failures:
            return NotificationDeliveryBulkRetryResult(
                succeeded_ids=[],
                failed=preflight_failures,
            )

    for delivery_id in payload.delivery_ids:
        try:
            retry_my_notification_delivery(current_user, delivery_id)
            succeeded_ids.append(delivery_id)
        except HTTPException as exc:
            failed.append(NotificationDeliveryBulkActionFailure(id=delivery_id, detail=str(exc.detail)))

    return NotificationDeliveryBulkRetryResult(
        succeeded_ids=succeeded_ids,
        failed=failed,
    )


def retry_admin_notification_deliveries(
    payload: NotificationDeliveryBulkRetryRequest,
) -> NotificationDeliveryBulkRetryResult:
    succeeded_ids: list[str] = []
    failed: list[NotificationDeliveryBulkActionFailure] = []
    atomic_mode = payload.execution_mode == "atomic"

    if atomic_mode:
        preflight_failures: list[NotificationDeliveryBulkActionFailure] = []
        for delivery_id in payload.delivery_ids:
            try:
                _validate_admin_notification_delivery_retry(delivery_id)
            except HTTPException as exc:
                preflight_failures.append(
                    NotificationDeliveryBulkActionFailure(id=delivery_id, detail=str(exc.detail)),
                )

        if preflight_failures:
            return NotificationDeliveryBulkRetryResult(
                succeeded_ids=[],
                failed=preflight_failures,
            )

    for delivery_id in payload.delivery_ids:
        try:
            retry_admin_notification_delivery(delivery_id)
            succeeded_ids.append(delivery_id)
        except HTTPException as exc:
            failed.append(NotificationDeliveryBulkActionFailure(id=delivery_id, detail=str(exc.detail)))

    return NotificationDeliveryBulkRetryResult(
        succeeded_ids=succeeded_ids,
        failed=failed,
    )
