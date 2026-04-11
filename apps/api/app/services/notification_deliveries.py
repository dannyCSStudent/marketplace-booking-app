from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.notifications import (
    NotificationDeliveryBulkActionFailure,
    NotificationDeliveryBulkRetryRequest,
    NotificationDeliveryBulkRetryResult,
    NotificationDeliveryRead,
    NotificationDeliverySummaryRead,
    NotificationWorkerHealthRead,
    TrustAlertEventRead,
    TrustAlertSellerSummaryRead,
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


def get_admin_notification_delivery_summary() -> NotificationDeliverySummaryRead:
    supabase = get_supabase_client()

    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "channel,delivery_status,transaction_kind,created_at",
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    now = datetime.now(timezone.utc)
    queued_timestamps: list[datetime] = []
    failed_timestamps: list[datetime] = []

    total_deliveries = len(rows)
    queued_deliveries = 0
    failed_deliveries = 0
    sent_deliveries = 0
    email_deliveries = 0
    push_deliveries = 0
    order_deliveries = 0
    booking_deliveries = 0
    failed_last_24h = 0
    queued_older_than_1h = 0

    for row in rows:
        status = row.get("delivery_status")
        channel = row.get("channel")
        transaction_kind = row.get("transaction_kind")
        created_at = row.get("created_at")
        parsed_created_at: datetime | None = None

        if isinstance(created_at, str):
            try:
                parsed_created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError:
                parsed_created_at = None

        if status == "queued":
            queued_deliveries += 1
            if parsed_created_at is not None:
                queued_timestamps.append(parsed_created_at)
                if now - parsed_created_at > timedelta(hours=1):
                    queued_older_than_1h += 1
        elif status == "failed":
            failed_deliveries += 1
            if parsed_created_at is not None:
                failed_timestamps.append(parsed_created_at)
                if now - parsed_created_at <= timedelta(hours=24):
                    failed_last_24h += 1
        elif status == "sent":
            sent_deliveries += 1

        if channel == "email":
            email_deliveries += 1
        elif channel == "push":
            push_deliveries += 1

        if transaction_kind == "order":
            order_deliveries += 1
        elif transaction_kind == "booking":
            booking_deliveries += 1

    return NotificationDeliverySummaryRead(
        total_deliveries=total_deliveries,
        queued_deliveries=queued_deliveries,
        failed_deliveries=failed_deliveries,
        sent_deliveries=sent_deliveries,
        email_deliveries=email_deliveries,
        push_deliveries=push_deliveries,
        order_deliveries=order_deliveries,
        booking_deliveries=booking_deliveries,
        failed_last_24h=failed_last_24h,
        queued_older_than_1h=queued_older_than_1h,
        oldest_queued_created_at=min(queued_timestamps) if queued_timestamps else None,
        latest_failure_created_at=max(failed_timestamps) if failed_timestamps else None,
    )


def get_admin_notification_worker_health() -> NotificationWorkerHealthRead:
    supabase = get_supabase_client()
    settings = get_settings()
    now = datetime.now(timezone.utc)

    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "delivery_status,created_at,next_attempt_at,last_attempt_at",
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    due_queued_timestamps: list[datetime] = []
    stuck_processing_timestamps: list[datetime] = []
    processing_deliveries = 0
    stuck_processing_deliveries = 0
    recent_failure_deliveries = 0

    for row in rows:
        status = row.get("delivery_status")
        created_at = _parse_timestamp(row.get("created_at"))
        next_attempt_at = _parse_timestamp(row.get("next_attempt_at"))
        last_attempt_at = _parse_timestamp(row.get("last_attempt_at"))

        if status == "queued" and (next_attempt_at is None or next_attempt_at <= now):
            if created_at is not None:
                due_queued_timestamps.append(created_at)
        if status == "processing":
            processing_deliveries += 1
            if last_attempt_at is None or now - last_attempt_at > timedelta(minutes=10):
                stuck_processing_deliveries += 1
                if last_attempt_at is not None:
                    stuck_processing_timestamps.append(last_attempt_at)
        if status == "failed" and created_at is not None and now - created_at <= timedelta(hours=24):
            recent_failure_deliveries += 1

    return NotificationWorkerHealthRead(
        email_provider=settings.notification_email_provider,
        push_provider=settings.notification_push_provider,
        worker_poll_seconds=settings.notification_worker_poll_seconds,
        batch_size=settings.notification_worker_batch_size,
        max_attempts=settings.notification_max_attempts,
        due_queued_deliveries=len(due_queued_timestamps),
        processing_deliveries=processing_deliveries,
        stuck_processing_deliveries=stuck_processing_deliveries,
        recent_failure_deliveries=recent_failure_deliveries,
        oldest_due_queued_created_at=min(due_queued_timestamps) if due_queued_timestamps else None,
        oldest_stuck_processing_last_attempt_at=min(stuck_processing_timestamps)
        if stuck_processing_timestamps
        else None,
    )


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


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


def acknowledge_admin_trust_alert(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_trust_alert_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_admin_trust_alert_acknowledgement(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_trust_alert_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _update_trust_alert_acknowledgement(
    *,
    seller_id: str,
    actor_user_id: str | None,
    acknowledged: bool,
) -> list[NotificationDeliveryRead]:
    supabase = get_supabase_client()
    now = datetime.now(timezone.utc).isoformat()

    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
                "payload->>alert_type": "eq.seller_trust_intervention",
                "payload->>seller_id": f"eq.{seller_id}",
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    updated_rows: list[dict] = []
    for row in rows:
        payload = dict(row.get("payload") or {})
        if acknowledged:
            payload["acknowledged_at"] = now
            if actor_user_id:
                payload["acknowledged_by_user_id"] = actor_user_id
            payload["acknowledged_signature"] = payload.get("alert_signature") or payload.get("acknowledged_signature")
        else:
            payload.pop("acknowledged_at", None)
            payload.pop("acknowledged_by_user_id", None)
            payload.pop("acknowledged_signature", None)
        try:
            updated = supabase.update(
                "notification_deliveries",
                {"payload": payload},
                query={
                    "id": f"eq.{row['id']}",
                    "select": (
                        "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                        "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                    ),
                },
                use_service_role=True,
            )
        except SupabaseError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        if updated:
            updated_rows.extend(updated)

    if updated_rows and actor_user_id:
        _insert_trust_alert_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return [NotificationDeliveryRead(**row) for row in updated_rows]


def _insert_trust_alert_events(
    *,
    rows: list[dict],
    action: str,
    actor_user_id: str,
) -> None:
    supabase = get_supabase_client()
    events: list[dict[str, str]] = []

    for row in rows:
        payload = row.get("payload") or {}
        seller_id = str(payload.get("seller_id") or "").strip()
        seller_slug = str(payload.get("seller_slug") or "").strip()
        seller_display_name = str(payload.get("seller_display_name") or "").strip()
        alert_signature = str(payload.get("acknowledged_signature") or payload.get("alert_signature") or "").strip()
        risk_level = str(payload.get("risk_level") or "").strip()
        trend_direction = str(payload.get("trend_direction") or "").strip()
        if not seller_id or not seller_slug or not seller_display_name or not alert_signature:
            continue

        events.append(
            {
                "seller_id": seller_id,
                "seller_slug": seller_slug,
                "seller_display_name": seller_display_name,
                "delivery_id": str(row.get("id")),
                "actor_user_id": actor_user_id,
                "action": action,
                "alert_signature": alert_signature,
                "risk_level": risk_level or "unknown",
                "trend_direction": trend_direction or "steady",
            }
        )

    if not events:
        return

    try:
        supabase.insert("trust_alert_events", events, use_service_role=True)
    except SupabaseError:
        return


def list_admin_trust_alert_events(limit: int = 20) -> list[TrustAlertEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "trust_alert_events",
            query={
                "select": (
                    "id,seller_id,seller_slug,seller_display_name,delivery_id,actor_user_id,"
                    "action,alert_signature,risk_level,trend_direction,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [TrustAlertEventRead(**row) for row in rows]


def list_admin_trust_alert_seller_summaries(
    limit: int = 8,
    action: str | None = None,
) -> list[TrustAlertSellerSummaryRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "trust_alert_events",
            query={
                "select": (
                    "seller_id,seller_slug,seller_display_name,action,risk_level,trend_direction,created_at"
                ),
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    grouped: dict[str, dict[str, object]] = {}
    allowed_actions = {"acknowledged", "cleared"} if action is None else {action}

    for row in rows:
        row_action = str(row.get("action") or "").strip()
        if allowed_actions and row_action not in allowed_actions:
            continue

        seller_id = str(row.get("seller_id") or "").strip()
        seller_slug = str(row.get("seller_slug") or "").strip()
        seller_display_name = str(row.get("seller_display_name") or "").strip()
        created_at = _parse_timestamp(row.get("created_at"))
        if not seller_id or not seller_slug or not seller_display_name or created_at is None:
            continue

        current = grouped.get(seller_id)
        if current is None:
            grouped[seller_id] = {
                "seller_id": seller_id,
                "seller_slug": seller_slug,
                "seller_display_name": seller_display_name,
                "event_count": 1,
                "latest_event_action": str(row.get("action") or "unknown"),
                "latest_event_risk_level": str(row.get("risk_level") or "unknown"),
                "latest_event_trend_direction": str(row.get("trend_direction") or "steady"),
                "latest_event_created_at": created_at,
            }
            continue

        current["event_count"] = int(current.get("event_count", 0)) + 1
        current_created_at = current.get("latest_event_created_at")
        if isinstance(current_created_at, datetime):
            if created_at is not None and created_at > current_created_at:
                current["latest_event_action"] = str(row.get("action") or "unknown")
                current["latest_event_risk_level"] = str(row.get("risk_level") or "unknown")
                current["latest_event_trend_direction"] = str(row.get("trend_direction") or "steady")
                current["latest_event_created_at"] = created_at

    summaries = [TrustAlertSellerSummaryRead(**summary) for summary in grouped.values()]
    summaries.sort(
        key=lambda summary: (
            -summary.event_count,
            -summary.latest_event_created_at.timestamp(),
            summary.seller_display_name.lower(),
        )
    )
    return summaries[: max(1, min(limit, 20))]
