from datetime import datetime, timedelta, timezone
from typing import Any

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
    BookingConflictEventRead,
    BookingConflictSellerSummaryRead,
    DeliveryFailureEventRead,
    DeliveryFailureSummaryRead,
    InventoryAlertEventRead,
    InventoryAlertSummaryRead,
    ReviewResponseReminderEventRead,
    ReviewResponseReminderSellerSummaryRead,
    OrderExceptionEventRead,
    OrderExceptionSellerSummaryRead,
    OrderFraudWatchBuyerSummaryRead,
    OrderFraudWatchEventRead,
    SellerProfileCompletionEventRead,
    SubscriptionDowngradeEventRead,
    SubscriptionDowngradeSellerSummaryRead,
    TrustAlertEventRead,
    TrustAlertSellerSummaryRead,
)

ORDER_FRAUD_WATCH_LOOKBACK_DAYS = 30
ORDER_FRAUD_WATCH_RECENT_WINDOW_DAYS = 7
ORDER_FRAUD_WATCH_MIN_EVENTS = 3


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


def queue_admin_delivery_failure_notifications(
    delivery: dict[str, Any],
    *,
    error_message: str,
    final: bool,
) -> None:
    if not final:
        return

    settings = get_settings()
    admin_ids = [
        admin_id
        for admin_id in settings.admin_user_ids
        if (settings.admin_user_roles or {}).get(admin_id, "").lower() in {"support", "owner"}
    ]
    if not admin_ids:
        admin_ids = list(settings.admin_user_ids)
    if not admin_ids:
        return

    supabase = get_supabase_client()
    try:
        profile_rows = supabase.select(
            "profiles",
            query={
                "select": "id,email_notifications_enabled,push_notifications_enabled",
                "id": f"in.({','.join(admin_ids)})",
            },
            use_service_role=True,
        )
        recent_rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "recipient_user_id,event_id",
                "recipient_user_id": f"in.({','.join(admin_ids)})",
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return

    profile_prefs = {row.get("id"): row for row in profile_rows if row.get("id")}
    event_id = f"delivery-failure:{delivery.get('id')}"
    existing_events = {
        (row.get("recipient_user_id"), row.get("event_id"))
        for row in recent_rows
        if row.get("recipient_user_id") and row.get("event_id")
    }

    delivery_id = str(delivery.get("id") or "").strip()
    original_transaction_kind = str(delivery.get("transaction_kind") or "delivery").strip() or "delivery"
    original_transaction_id = str(delivery.get("transaction_id") or delivery_id or "").strip()
    channel = str(delivery.get("channel") or "unknown").strip() or "unknown"
    attempts = int(delivery.get("attempts") or 0)
    failure_reason = str(error_message or delivery.get("failure_reason") or "Unknown delivery failure").strip()
    subject = f"Delivery failure for {original_transaction_kind} {original_transaction_id or delivery_id}"
    body = failure_reason[:240]
    html = (
        f"<p>Notification delivery failed for <strong>{original_transaction_kind} {original_transaction_id or delivery_id}</strong>.</p>"
        f"<p><strong>Channel:</strong> {channel}</p>"
        f"<p><strong>Attempts:</strong> {attempts}</p>"
        f"<p><strong>Failure:</strong> {failure_reason}</p>"
    )

    deliveries: list[dict[str, object]] = []
    for admin_id in admin_ids:
        if (admin_id, event_id) in existing_events:
            continue

        prefs = profile_prefs.get(admin_id, {})
        payload = {
            "alert_type": "delivery_failure",
            "failed_delivery_id": delivery_id,
            "failed_delivery_channel": channel,
            "failed_delivery_status": delivery.get("delivery_status") or "failed",
            "failed_delivery_attempts": attempts,
            "failed_delivery_reason": failure_reason,
            "original_recipient_user_id": delivery.get("recipient_user_id"),
            "alert_signature": event_id,
            "subject": subject,
            "body": body,
            "html": html,
        }

        if prefs.get("email_notifications_enabled", True):
            deliveries.append(
                {
                    "recipient_user_id": admin_id,
                    "transaction_kind": original_transaction_kind,
                    "transaction_id": original_transaction_id or delivery_id,
                    "event_id": event_id,
                    "channel": "email",
                    "delivery_status": "queued",
                    "payload": payload,
                }
            )

        if prefs.get("push_notifications_enabled", True):
            deliveries.append(
                {
                    "recipient_user_id": admin_id,
                    "transaction_kind": original_transaction_kind,
                    "transaction_id": original_transaction_id or delivery_id,
                    "event_id": event_id,
                    "channel": "push",
                    "delivery_status": "queued",
                    "payload": payload,
                }
            )

    if not deliveries:
        return

    try:
        supabase.insert("notification_deliveries", deliveries, use_service_role=True)
    except SupabaseError:
        return


def queue_seller_profile_completion_notifications(
    seller: dict[str, Any],
    completion: dict[str, Any],
) -> None:
    if completion.get("is_complete"):
        return

    seller_id = str(seller.get("id") or "").strip()
    seller_user_id = str(seller.get("user_id") or "").strip()
    seller_slug = str(seller.get("slug") or "").strip()
    seller_display_name = str(seller.get("display_name") or "Seller").strip() or "Seller"
    if not seller_id or not seller_user_id:
        return

    missing_fields = [str(field).strip() for field in completion.get("missing_fields") or [] if str(field).strip()]
    completion_percent = int(completion.get("completion_percent") or 0)
    summary = str(completion.get("summary") or "").strip() or "Complete the remaining profile fields."
    signature = f"{seller_id}:{completion_percent}:{','.join(sorted(missing_fields))}"
    event_id = f"seller-profile-completion:{signature}"

    supabase = get_supabase_client()
    try:
        profile_rows = supabase.select(
            "profiles",
            query={
                "select": "id,email_notifications_enabled,push_notifications_enabled",
                "id": f"eq.{seller_user_id}",
            },
            use_service_role=True,
        )
        recent_rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "recipient_user_id,event_id",
                "recipient_user_id": f"eq.{seller_user_id}",
                "order": "created_at.desc",
                "limit": "50",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return

    profile = profile_rows[0] if profile_rows else {}
    existing_events = {
        (row.get("recipient_user_id"), row.get("event_id"))
        for row in recent_rows
        if row.get("recipient_user_id") and row.get("event_id")
    }
    if (seller_user_id, event_id) in existing_events:
        return

    deliveries: list[dict[str, object]] = []
    subject = f"Finish your {seller_display_name} profile"
    body = summary
    html_lines = [
        f"<p>Finish the profile for <strong>{seller_display_name}</strong>.</p>",
        f"<p><strong>Completion:</strong> {completion_percent}%</p>",
    ]
    if missing_fields:
        html_lines.append(f"<p><strong>Missing:</strong> {', '.join(missing_fields)}</p>")
    html_lines.append(f"<p>{summary}</p>")
    html = "".join(html_lines)
    payload = {
        "alert_type": "seller_profile_completion",
        "seller_id": seller_id,
        "seller_slug": seller_slug,
        "seller_display_name": seller_display_name,
        "completion_percent": completion_percent,
        "missing_fields": missing_fields,
        "summary": summary,
        "is_complete": False,
        "alert_signature": signature,
        "subject": subject,
        "body": body,
        "html": html,
    }

    if profile.get("email_notifications_enabled", True):
        deliveries.append(
            {
                "recipient_user_id": seller_user_id,
                "transaction_kind": "seller",
                "transaction_id": seller_id,
                "event_id": event_id,
                "channel": "email",
                "delivery_status": "queued",
                "payload": payload,
            }
        )

    if profile.get("push_notifications_enabled", True):
        deliveries.append(
            {
                "recipient_user_id": seller_user_id,
                "transaction_kind": "seller",
                "transaction_id": seller_id,
                "event_id": event_id,
                "channel": "push",
                "delivery_status": "queued",
                "payload": payload,
            }
        )

    if not deliveries:
        return

    try:
        inserted_rows = supabase.insert("notification_deliveries", deliveries, use_service_role=True)
    except SupabaseError:
        return

    if inserted_rows:
        try:
            from app.services.notification_delivery_worker import process_notification_delivery_rows

            process_notification_delivery_rows(inserted_rows)
        except Exception:
            return


def acknowledge_admin_seller_profile_completion(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_seller_profile_completion_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_admin_seller_profile_completion_acknowledgement(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_seller_profile_completion_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _update_seller_profile_completion_acknowledgement(
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
                "payload->>alert_type": "eq.seller_profile_completion",
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
        _insert_seller_profile_completion_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return [NotificationDeliveryRead(**row) for row in updated_rows]


def _insert_seller_profile_completion_events(
    *,
    rows: list[dict],
    action: str,
    actor_user_id: str,
) -> None:
    supabase = get_supabase_client()
    events: list[dict[str, object]] = []

    for row in rows:
        payload = row.get("payload") or {}
        seller_id = str(payload.get("seller_id") or "").strip()
        seller_slug = str(payload.get("seller_slug") or "").strip()
        seller_display_name = str(payload.get("seller_display_name") or "").strip()
        alert_signature = str(payload.get("acknowledged_signature") or payload.get("alert_signature") or "").strip()
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
                "completion_percent": int(payload.get("completion_percent") or 0),
                "missing_fields": list(payload.get("missing_fields") or []),
                "summary": str(payload.get("summary") or "").strip(),
            }
        )

    if not events:
        return

    try:
        supabase.insert("seller_profile_completion_events", events, use_service_role=True)
    except SupabaseError:
        return


def list_admin_seller_profile_completion_events(limit: int = 20) -> list[SellerProfileCompletionEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "seller_profile_completion_events",
            query={
                "select": (
                    "id,seller_id,seller_slug,seller_display_name,delivery_id,actor_user_id,action,"
                    "alert_signature,completion_percent,missing_fields,summary,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [SellerProfileCompletionEventRead(**row) for row in rows]


def acknowledge_admin_delivery_failure(
    failed_delivery_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_delivery_failure_acknowledgement(
        failed_delivery_id=failed_delivery_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_admin_delivery_failure_acknowledgement(
    failed_delivery_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_delivery_failure_acknowledgement(
        failed_delivery_id=failed_delivery_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _update_delivery_failure_acknowledgement(
    *,
    failed_delivery_id: str,
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
                "payload->>alert_type": "eq.delivery_failure",
                "payload->>failed_delivery_id": f"eq.{failed_delivery_id}",
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
        _insert_delivery_failure_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return [NotificationDeliveryRead(**row) for row in updated_rows]


def _insert_delivery_failure_events(
    *,
    rows: list[dict],
    action: str,
    actor_user_id: str,
) -> None:
    supabase = get_supabase_client()
    events: list[dict[str, object]] = []

    for row in rows:
        payload = row.get("payload") or {}
        failed_delivery_id = str(payload.get("failed_delivery_id") or "").strip()
        alert_signature = str(payload.get("acknowledged_signature") or payload.get("alert_signature") or "").strip()
        failed_delivery_channel = str(payload.get("failed_delivery_channel") or row.get("channel") or "unknown").strip()
        failed_delivery_status = str(payload.get("failed_delivery_status") or row.get("delivery_status") or "unknown").strip()
        failed_delivery_attempts = int(payload.get("failed_delivery_attempts") or row.get("attempts") or 0)
        failed_delivery_reason = str(payload.get("failed_delivery_reason") or row.get("failure_reason") or "Unknown delivery failure").strip()
        original_recipient_user_id = payload.get("original_recipient_user_id")
        if not failed_delivery_id or not alert_signature:
            continue

        events.append(
            {
                "failed_delivery_id": failed_delivery_id,
                "delivery_id": row.get("id"),
                "actor_user_id": actor_user_id,
                "action": action,
                "alert_signature": alert_signature,
                "failed_delivery_channel": failed_delivery_channel or "unknown",
                "failed_delivery_status": failed_delivery_status or "unknown",
                "failed_delivery_attempts": failed_delivery_attempts,
                "failed_delivery_reason": failed_delivery_reason,
                "original_recipient_user_id": original_recipient_user_id or None,
            }
        )

    if not events:
        return

    try:
        supabase.insert("delivery_failure_events", events, use_service_role=True)
    except SupabaseError:
        return


def acknowledge_admin_review_response_reminder(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_review_response_reminder_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_admin_review_response_reminder_acknowledgement(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_review_response_reminder_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _update_review_response_reminder_acknowledgement(
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
                "payload->>alert_type": "eq.review_response_reminder",
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
        _insert_review_response_reminder_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return [NotificationDeliveryRead(**row) for row in updated_rows]


def _insert_review_response_reminder_events(
    *,
    rows: list[dict],
    action: str,
    actor_user_id: str,
) -> None:
    supabase = get_supabase_client()
    events: list[dict[str, object]] = []

    for row in rows:
        payload = row.get("payload") or {}
        seller_id = str(payload.get("seller_id") or "").strip()
        seller_slug = str(payload.get("seller_slug") or "").strip()
        seller_display_name = str(payload.get("seller_display_name") or "").strip()
        alert_signature = str(payload.get("acknowledged_signature") or payload.get("alert_signature") or "").strip()
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
                "latest_review_id": str(payload.get("latest_review_id") or "").strip() or None,
                "latest_review_rating": int(payload.get("latest_review_rating") or 0),
                "pending_review_count": int(payload.get("pending_review_count") or 0),
            }
        )

    if not events:
        return

    try:
        supabase.insert("review_response_reminder_events", events, use_service_role=True)
    except SupabaseError:
        return


def list_admin_review_response_reminder_events(limit: int = 20) -> list[ReviewResponseReminderEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "review_response_reminder_events",
            query={
                "select": (
                    "id,seller_id,seller_slug,seller_display_name,delivery_id,actor_user_id,"
                    "action,alert_signature,latest_review_id,latest_review_rating,pending_review_count,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [ReviewResponseReminderEventRead(**row) for row in rows]


def list_admin_review_response_reminder_seller_summaries(
    limit: int = 8,
    state: str | None = None,
) -> list[ReviewResponseReminderSellerSummaryRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,channel,"
                    "delivery_status,payload,created_at"
                ),
                "payload->>alert_type": "eq.review_response_reminder",
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    grouped: dict[str, dict[str, object]] = {}
    effective_state = state or "active"

    for row in rows:
        payload = row.get("payload") or {}
        seller_id = str(payload.get("seller_id") or "").strip()
        created_at = _parse_timestamp(row.get("created_at"))
        if not seller_id or created_at is None:
            continue

        acknowledged_signature = str(payload.get("acknowledged_signature") or "").strip()
        alert_signature = str(payload.get("alert_signature") or "").strip()
        is_acknowledged = bool(acknowledged_signature) and acknowledged_signature == alert_signature
        current = grouped.get(seller_id)
        if current is None:
            grouped[seller_id] = {
                "seller_id": seller_id,
                "seller_slug": str(payload.get("seller_slug") or "").strip(),
                "seller_display_name": str(payload.get("seller_display_name") or "").strip(),
                "reminder_count": int(payload.get("pending_review_count") or 0) or 1,
                "latest_review_id": str(payload.get("latest_review_id") or "").strip() or None,
                "latest_review_rating": int(payload.get("latest_review_rating") or 0) or None,
                "latest_alert_delivery_status": str(row.get("delivery_status") or "unknown"),
                "latest_alert_delivery_created_at": created_at,
                "acknowledged": is_acknowledged,
            }
            continue

        current["reminder_count"] = int(current.get("reminder_count", 0)) + 1
        current_created_at = current.get("latest_alert_delivery_created_at")
        if isinstance(current_created_at, datetime) and created_at > current_created_at:
            current["seller_slug"] = str(payload.get("seller_slug") or "").strip()
            current["seller_display_name"] = str(payload.get("seller_display_name") or "").strip()
            current["latest_review_id"] = str(payload.get("latest_review_id") or "").strip() or None
            current["latest_review_rating"] = int(payload.get("latest_review_rating") or 0) or None
            current["latest_alert_delivery_status"] = str(row.get("delivery_status") or "unknown")
            current["latest_alert_delivery_created_at"] = created_at
            current["acknowledged"] = is_acknowledged

    summaries = [ReviewResponseReminderSellerSummaryRead(**summary) for summary in grouped.values()]
    if effective_state == "active":
        summaries = [summary for summary in summaries if not summary.acknowledged]
    elif effective_state == "acknowledged":
        summaries = [summary for summary in summaries if summary.acknowledged]
    summaries.sort(
        key=lambda summary: (
            -summary.latest_alert_delivery_created_at.timestamp(),
            summary.seller_id,
        )
    )
    return summaries[: max(1, min(limit, 20))]


def list_admin_delivery_failure_events(limit: int = 20) -> list[DeliveryFailureEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "delivery_failure_events",
            query={
                "select": (
                    "id,failed_delivery_id,delivery_id,actor_user_id,action,alert_signature,"
                    "failed_delivery_channel,failed_delivery_status,failed_delivery_attempts,"
                    "failed_delivery_reason,original_recipient_user_id,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [DeliveryFailureEventRead(**row) for row in rows]


def list_admin_delivery_failure_summaries(
    limit: int = 6,
    state: str | None = None,
) -> list[DeliveryFailureSummaryRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,created_at"
                ),
                "payload->>alert_type": "eq.delivery_failure",
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    grouped: dict[str, dict[str, object]] = {}
    effective_state = state or "active"

    for row in rows:
        payload = row.get("payload") or {}
        failed_delivery_id = str(payload.get("failed_delivery_id") or "").strip()
        alert_signature = str(payload.get("alert_signature") or "").strip()
        created_at = _parse_timestamp(row.get("created_at"))
        if not failed_delivery_id or created_at is None:
            continue

        acknowledged_signature = str(payload.get("acknowledged_signature") or "").strip()
        is_acknowledged = bool(acknowledged_signature) and acknowledged_signature == alert_signature
        current = grouped.get(failed_delivery_id)
        if current is None:
            grouped[failed_delivery_id] = {
                "failed_delivery_id": failed_delivery_id,
                "transaction_kind": str(row.get("transaction_kind") or "delivery"),
                "transaction_id": str(row.get("transaction_id") or failed_delivery_id),
                "failed_delivery_channel": str(payload.get("failed_delivery_channel") or row.get("channel") or "unknown"),
                "failed_delivery_status": str(payload.get("failed_delivery_status") or row.get("delivery_status") or "unknown"),
                "failed_delivery_attempts": int(payload.get("failed_delivery_attempts") or row.get("attempts") or 0),
                "failed_delivery_reason": str(payload.get("failed_delivery_reason") or row.get("failure_reason") or "Unknown delivery failure"),
                "original_recipient_user_id": str(payload.get("original_recipient_user_id") or row.get("recipient_user_id") or "").strip() or None,
                "alert_delivery_count": 1,
                "latest_alert_delivery_status": str(row.get("delivery_status") or "unknown"),
                "latest_alert_delivery_created_at": created_at,
                "acknowledged": is_acknowledged,
            }
            continue

        current["alert_delivery_count"] = int(current.get("alert_delivery_count", 0)) + 1
        current_created_at = current.get("latest_alert_delivery_created_at")
        if isinstance(current_created_at, datetime):
            if created_at > current_created_at:
                current["failed_delivery_channel"] = str(payload.get("failed_delivery_channel") or row.get("channel") or "unknown")
                current["failed_delivery_status"] = str(payload.get("failed_delivery_status") or row.get("delivery_status") or "unknown")
                current["failed_delivery_attempts"] = int(payload.get("failed_delivery_attempts") or row.get("attempts") or 0)
                current["failed_delivery_reason"] = str(payload.get("failed_delivery_reason") or row.get("failure_reason") or "Unknown delivery failure")
                current["original_recipient_user_id"] = str(payload.get("original_recipient_user_id") or row.get("recipient_user_id") or "").strip() or None
                current["latest_alert_delivery_status"] = str(row.get("delivery_status") or "unknown")
                current["latest_alert_delivery_created_at"] = created_at
                current["acknowledged"] = is_acknowledged

    summaries = [DeliveryFailureSummaryRead(**summary) for summary in grouped.values()]
    if effective_state == "active":
        summaries = [summary for summary in summaries if not summary.acknowledged]
    elif effective_state == "acknowledged":
        summaries = [summary for summary in summaries if summary.acknowledged]
    summaries.sort(
        key=lambda summary: (
            -summary.latest_alert_delivery_created_at.timestamp(),
            summary.failed_delivery_id,
        )
    )
    return summaries[: max(1, min(limit, 20))]


def acknowledge_admin_inventory_alert(
    seller_id: str,
    listing_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_inventory_alert_acknowledgement(
        seller_id=seller_id,
        listing_id=listing_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_admin_inventory_alert_acknowledgement(
    seller_id: str,
    listing_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_inventory_alert_acknowledgement(
        seller_id=seller_id,
        listing_id=listing_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _update_inventory_alert_acknowledgement(
    *,
    seller_id: str,
    listing_id: str,
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
                "payload->>alert_type": "eq.inventory_alert",
                "payload->>seller_id": f"eq.{seller_id}",
                "payload->>listing_id": f"eq.{listing_id}",
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
        _insert_inventory_alert_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return [NotificationDeliveryRead(**row) for row in updated_rows]


def _insert_inventory_alert_events(
    *,
    rows: list[dict],
    action: str,
    actor_user_id: str,
) -> None:
    supabase = get_supabase_client()
    events: list[dict[str, object]] = []

    for row in rows:
        payload = row.get("payload") or {}
        seller_id = str(payload.get("seller_id") or "").strip()
        seller_slug = str(payload.get("seller_slug") or "").strip()
        seller_display_name = str(payload.get("seller_display_name") or "").strip()
        alert_signature = str(payload.get("acknowledged_signature") or payload.get("alert_signature") or "").strip()
        listing_id = str(payload.get("listing_id") or row.get("transaction_id") or "").strip()
        listing_title = str(payload.get("listing_title") or "Listing").strip()
        inventory_bucket = str(payload.get("inventory_bucket") or "low_stock").strip()
        inventory_count = payload.get("inventory_count")
        if not seller_id or not seller_slug or not seller_display_name or not alert_signature or not listing_id:
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
                "listing_id": listing_id,
                "listing_title": listing_title,
                "inventory_bucket": inventory_bucket or "low_stock",
                "inventory_count": int(inventory_count) if inventory_count is not None else None,
            }
        )

    if not events:
        return

    try:
        supabase.insert("inventory_alert_events", events, use_service_role=True)
    except SupabaseError:
        return


def list_admin_inventory_alert_events(limit: int = 20) -> list[InventoryAlertEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "inventory_alert_events",
            query={
                "select": (
                    "id,seller_id,seller_slug,seller_display_name,delivery_id,actor_user_id,"
                    "action,alert_signature,listing_id,listing_title,inventory_bucket,inventory_count,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [InventoryAlertEventRead(**row) for row in rows]


def list_admin_inventory_alert_summaries(
    limit: int = 8,
    state: str | None = None,
) -> list[InventoryAlertSummaryRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,channel,"
                    "delivery_status,payload,created_at"
                ),
                "payload->>alert_type": "eq.inventory_alert",
                "order": "created_at.desc",
                "limit": "300",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    grouped: dict[str, dict[str, object]] = {}
    effective_state = state or "active"

    for row in rows:
        payload = row.get("payload") or {}
        seller_id = str(payload.get("seller_id") or "").strip()
        seller_slug = str(payload.get("seller_slug") or "").strip()
        seller_display_name = str(payload.get("seller_display_name") or "").strip()
        listing_id = str(payload.get("listing_id") or row.get("transaction_id") or "").strip()
        listing_title = str(payload.get("listing_title") or "Listing").strip()
        inventory_bucket = str(payload.get("inventory_bucket") or "low_stock").strip()
        inventory_count = payload.get("inventory_count")
        created_at = _parse_timestamp(row.get("created_at"))
        if not seller_id or not seller_slug or not seller_display_name or not listing_id or created_at is None:
            continue

        alert_signature = str(payload.get("alert_signature") or "").strip()
        acknowledged_signature = str(payload.get("acknowledged_signature") or "").strip()
        is_acknowledged = bool(acknowledged_signature) and acknowledged_signature == alert_signature
        group_key = f"{seller_id}:{listing_id}"
        current = grouped.get(group_key)
        if current is None:
            grouped[group_key] = {
                "seller_id": seller_id,
                "seller_slug": seller_slug,
                "seller_display_name": seller_display_name,
                "listing_id": listing_id,
                "listing_title": listing_title,
                "inventory_bucket": inventory_bucket or "low_stock",
                "inventory_count": int(inventory_count) if inventory_count is not None else None,
                "alert_delivery_count": 1,
                "latest_alert_delivery_status": str(row.get("delivery_status") or "unknown"),
                "latest_alert_delivery_created_at": created_at,
                "acknowledged": is_acknowledged,
            }
            continue

        current["alert_delivery_count"] = int(current.get("alert_delivery_count", 0)) + 1
        current_created_at = current.get("latest_alert_delivery_created_at")
        if isinstance(current_created_at, datetime) and created_at > current_created_at:
            current["seller_slug"] = seller_slug
            current["seller_display_name"] = seller_display_name
            current["listing_title"] = listing_title
            current["inventory_bucket"] = inventory_bucket or "low_stock"
            current["inventory_count"] = int(inventory_count) if inventory_count is not None else None
            current["latest_alert_delivery_status"] = str(row.get("delivery_status") or "unknown")
            current["latest_alert_delivery_created_at"] = created_at
            current["acknowledged"] = is_acknowledged

    summaries = [InventoryAlertSummaryRead(**summary) for summary in grouped.values()]
    if effective_state == "active":
        summaries = [summary for summary in summaries if not summary.acknowledged]
    elif effective_state == "acknowledged":
        summaries = [summary for summary in summaries if summary.acknowledged]
    summaries.sort(
        key=lambda summary: (
            -summary.latest_alert_delivery_created_at.timestamp(),
            summary.seller_display_name.lower(),
            summary.listing_title.lower(),
        )
    )
    return summaries[: max(1, min(limit, 20))]


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


def list_admin_order_exception_seller_summaries(
    limit: int = 6,
    action: str | None = None,
) -> list[OrderExceptionSellerSummaryRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "order_exception_events",
            query={
                "select": (
                    "seller_id,seller_slug,seller_display_name,action,order_status,created_at"
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
        if row_action not in allowed_actions:
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
                "latest_event_action": row_action or "unknown",
                "latest_event_status": str(row.get("order_status") or "unknown"),
                "latest_event_created_at": created_at,
            }
            continue

        current["event_count"] = int(current.get("event_count", 0)) + 1
        current_created_at = current.get("latest_event_created_at")
        if isinstance(current_created_at, datetime) and created_at > current_created_at:
            current["latest_event_action"] = row_action or "unknown"
            current["latest_event_status"] = str(row.get("order_status") or "unknown")
            current["latest_event_created_at"] = created_at

    summaries = [OrderExceptionSellerSummaryRead(**summary) for summary in grouped.values()]
    summaries.sort(
        key=lambda summary: (
            -summary.event_count,
            -summary.latest_event_created_at.timestamp(),
            summary.seller_display_name.lower(),
        )
    )
    return summaries[: max(1, min(limit, 20))]


def list_admin_booking_conflict_seller_summaries(
    limit: int = 6,
    action: str | None = None,
) -> list[BookingConflictSellerSummaryRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "booking_conflict_events",
            query={
                "select": (
                    "seller_id,seller_slug,seller_display_name,action,conflict_count,created_at"
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
        if row_action not in allowed_actions:
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
                "latest_event_action": row_action or "unknown",
                "latest_event_status": "conflict",
                "latest_event_created_at": created_at,
            }
            continue

        current["event_count"] = int(current.get("event_count", 0)) + 1
        current_created_at = current.get("latest_event_created_at")
        if isinstance(current_created_at, datetime) and created_at > current_created_at:
            current["latest_event_action"] = row_action or "unknown"
            current["latest_event_created_at"] = created_at

    summaries = [BookingConflictSellerSummaryRead(**summary) for summary in grouped.values()]
    summaries.sort(
        key=lambda summary: (
            -summary.event_count,
            -summary.latest_event_created_at.timestamp(),
            summary.seller_display_name.lower(),
        )
    )
    return summaries[: max(1, min(limit, 20))]


def acknowledge_admin_order_exception(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_order_exception_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_admin_order_exception_acknowledgement(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_order_exception_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _update_order_exception_acknowledgement(
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
                "payload->>alert_type": "eq.order_exception",
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
        _insert_order_exception_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return [NotificationDeliveryRead(**row) for row in updated_rows]


def _insert_order_exception_events(
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
        order_id = str(payload.get("order_id") or "").strip()
        order_status = str(payload.get("current_status") or "").strip()
        if not seller_id or not seller_slug or not seller_display_name or not alert_signature or not order_id:
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
                "order_id": order_id,
                "order_status": order_status or "unknown",
            }
        )

    if not events:
        return

    try:
        supabase.insert("order_exception_events", events, use_service_role=True)
    except SupabaseError:
        return


def list_admin_order_exception_events(limit: int = 20) -> list[OrderExceptionEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "order_exception_events",
            query={
                "select": (
                    "id,seller_id,seller_slug,seller_display_name,delivery_id,actor_user_id,"
                    "action,alert_signature,order_id,order_status,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [OrderExceptionEventRead(**row) for row in rows]


def queue_order_fraud_watch_notifications(
    *,
    order: dict[str, Any],
    previous_status: str,
    actor_role: str,
) -> None:
    if actor_role != "buyer" or previous_status not in ORDER_EXCEPTION_TRIGGER_STATUSES or order.get("status") != "canceled":
        return

    buyer_id = str(order.get("buyer_id") or "").strip()
    if not buyer_id:
        return

    supabase = get_supabase_client()
    since = (datetime.now(timezone.utc) - timedelta(days=ORDER_FRAUD_WATCH_LOOKBACK_DAYS)).isoformat()

    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "event_id,payload,created_at",
                "payload->>alert_type": "eq.order_exception",
                "payload->>buyer_id": f"eq.{buyer_id}",
                "payload->>actor_role": "eq.buyer",
                "created_at": f"gte.{since}",
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return

    unique_events: dict[str, dict[str, object]] = {}
    for row in rows:
        event_id = str(row.get("event_id") or "").strip()
        created_at = _parse_timestamp(row.get("created_at"))
        if not event_id or created_at is None:
            continue

        current = unique_events.get(event_id)
        if current is None or created_at > current["created_at"]:
            unique_events[event_id] = {
                "row": row,
                "created_at": created_at,
            }

    if len(unique_events) < ORDER_FRAUD_WATCH_MIN_EVENTS:
        return

    latest_event = max(unique_events.values(), key=lambda item: item["created_at"])
    latest_row = latest_event["row"]
    latest_payload = latest_row.get("payload") or {}
    latest_order_id = str(latest_payload.get("order_id") or "").strip()
    latest_order_status = str(latest_payload.get("current_status") or "").strip() or "canceled"
    order_exception_count = len(unique_events)
    recent_threshold = datetime.now(timezone.utc) - timedelta(days=ORDER_FRAUD_WATCH_RECENT_WINDOW_DAYS)
    recent_order_exception_count = sum(
        1
        for item in unique_events.values()
        if item["created_at"] >= recent_threshold
    )
    risk_level = _order_fraud_watch_risk_level(order_exception_count)
    alert_reason = (
        f"{order_exception_count} buyer-triggered order cancellation alert"
        f"{'s' if order_exception_count != 1 else ''} in {ORDER_FRAUD_WATCH_LOOKBACK_DAYS} days."
    )
    alert_signature = str(latest_payload.get("alert_signature") or latest_row.get("event_id") or "").strip()
    event_id = f"order-fraud-watch:{buyer_id}:{order_exception_count}:{alert_signature}"

    try:
        existing_rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "recipient_user_id,event_id",
                "event_id": f"eq.{event_id}",
            },
            use_service_role=True,
        )
    except SupabaseError:
        existing_rows = []

    if existing_rows:
        return

    try:
        buyer_profile = supabase.select(
            "profiles",
            query={
                "select": "id,display_name",
                "id": f"eq.{buyer_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError:
        buyer_profile = {"display_name": ""}

    buyer_display_name = str(buyer_profile.get("display_name") or "").strip() or "Buyer"

    settings = get_settings()
    admin_ids = [
        admin_id
        for admin_id in settings.admin_user_ids
        if (settings.admin_user_roles or {}).get(admin_id, "").lower() in {"support", "owner"}
    ]
    if not admin_ids:
        admin_ids = list(settings.admin_user_ids)
    if not admin_ids:
        return

    recipient_user_ids = list(dict.fromkeys(admin_ids))
    try:
        profile_rows = supabase.select(
            "profiles",
            query={
                "select": "id,email_notifications_enabled,push_notifications_enabled",
                "id": f"in.({','.join(recipient_user_ids)})",
            },
            use_service_role=True,
        )
    except SupabaseError:
        profile_rows = []

    profile_prefs = {
        str(row.get("id")): row
        for row in profile_rows
        if row.get("id")
    }

    subject = f"Order fraud watch for {buyer_display_name}"
    body = alert_reason
    html = (
        f"<p>Order fraud watch for <strong>{buyer_display_name}</strong>.</p>"
        f"<p><strong>Order exception alerts:</strong> {order_exception_count}</p>"
        f"<p><strong>Recent alerts:</strong> {recent_order_exception_count}</p>"
        f"<p><strong>Risk:</strong> {risk_level}</p>"
        f"<p>{alert_reason}</p>"
    )

    deliveries: list[dict[str, object]] = []
    for recipient_user_id in recipient_user_ids:
        prefs = profile_prefs.get(recipient_user_id, {})
        payload = {
            "alert_type": "order_fraud_watch",
            "buyer_id": buyer_id,
            "buyer_display_name": buyer_display_name,
            "latest_order_id": latest_order_id,
            "latest_order_status": latest_order_status,
            "order_exception_count": order_exception_count,
            "recent_order_exception_count": recent_order_exception_count,
            "risk_level": risk_level,
            "alert_reason": alert_reason,
            "alert_signature": event_id,
            "subject": subject,
            "body": body,
            "html": html,
        }

        if prefs.get("email_notifications_enabled", True):
            deliveries.append(
                {
                    "recipient_user_id": recipient_user_id,
                    "transaction_kind": "order",
                    "transaction_id": latest_order_id or order.get("id") or buyer_id,
                    "event_id": event_id,
                    "channel": "email",
                    "delivery_status": "queued",
                    "payload": payload,
                }
            )

        if prefs.get("push_notifications_enabled", True):
            deliveries.append(
                {
                    "recipient_user_id": recipient_user_id,
                    "transaction_kind": "order",
                    "transaction_id": latest_order_id or order.get("id") or buyer_id,
                    "event_id": event_id,
                    "channel": "push",
                    "delivery_status": "queued",
                    "payload": payload,
                }
            )

    if not deliveries:
        return

    try:
        inserted_rows = supabase.insert("notification_deliveries", deliveries, use_service_role=True)
    except SupabaseError:
        return

    if inserted_rows:
        try:
            from app.services.notification_delivery_worker import process_notification_delivery_rows

            process_notification_delivery_rows(inserted_rows)
        except Exception:
            return


def acknowledge_admin_order_fraud_watch(
    buyer_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_order_fraud_watch_acknowledgement(
        buyer_id=buyer_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_admin_order_fraud_watch_acknowledgement(
    buyer_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_order_fraud_watch_acknowledgement(
        buyer_id=buyer_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _update_order_fraud_watch_acknowledgement(
    *,
    buyer_id: str,
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
                "payload->>alert_type": "eq.order_fraud_watch",
                "payload->>buyer_id": f"eq.{buyer_id}",
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
        _insert_order_fraud_watch_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return [NotificationDeliveryRead(**row) for row in updated_rows]


def _insert_order_fraud_watch_events(
    *,
    rows: list[dict],
    action: str,
    actor_user_id: str,
) -> None:
    supabase = get_supabase_client()
    events: list[dict[str, object]] = []

    for row in rows:
        payload = row.get("payload") or {}
        buyer_id = str(payload.get("buyer_id") or "").strip()
        buyer_display_name = str(payload.get("buyer_display_name") or "").strip()
        alert_signature = str(payload.get("acknowledged_signature") or payload.get("alert_signature") or "").strip()
        order_exception_count = int(payload.get("order_exception_count") or 0)
        recent_order_exception_count = int(payload.get("recent_order_exception_count") or 0)
        risk_level = str(payload.get("risk_level") or "watch").strip() or "watch"
        latest_order_id = str(payload.get("latest_order_id") or "").strip() or None
        latest_order_status = str(payload.get("latest_order_status") or "").strip() or None
        if not buyer_id or not buyer_display_name or not alert_signature:
            continue

        events.append(
            {
                "buyer_id": buyer_id,
                "buyer_display_name": buyer_display_name,
                "delivery_id": str(row.get("id")),
                "actor_user_id": actor_user_id,
                "action": action,
                "alert_signature": alert_signature,
                "order_exception_count": order_exception_count,
                "recent_order_exception_count": recent_order_exception_count,
                "risk_level": risk_level,
                "latest_order_id": latest_order_id,
                "latest_order_status": latest_order_status,
            }
        )

    if not events:
        return

    try:
        supabase.insert("order_fraud_watch_events", events, use_service_role=True)
    except SupabaseError:
        return


def list_admin_order_fraud_watch_events(limit: int = 20) -> list[OrderFraudWatchEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "order_fraud_watch_events",
            query={
                "select": (
                    "id,buyer_id,buyer_display_name,delivery_id,actor_user_id,action,alert_signature,"
                    "order_exception_count,recent_order_exception_count,risk_level,latest_order_id,"
                    "latest_order_status,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [OrderFraudWatchEventRead(**row) for row in rows]


def list_admin_order_fraud_watch_buyer_summaries(
    limit: int = 6,
    state: str | None = None,
) -> list[OrderFraudWatchBuyerSummaryRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
                "payload->>alert_type": "eq.order_fraud_watch",
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    grouped: dict[str, dict[str, object]] = {}
    allowed_states = {"active"} if state is None else {"active", "acknowledged"} if state == "all" else {state}

    for row in rows:
        payload = row.get("payload") or {}
        buyer_id = str(payload.get("buyer_id") or "").strip()
        buyer_display_name = str(payload.get("buyer_display_name") or "").strip()
        created_at = _parse_timestamp(row.get("created_at"))
        alert_signature = str(payload.get("alert_signature") or "").strip()
        if not buyer_id or not buyer_display_name or created_at is None or not alert_signature:
            continue

        acknowledged_signature = str(payload.get("acknowledged_signature") or "").strip()
        is_acknowledged = bool(acknowledged_signature) and acknowledged_signature == alert_signature
        row_state = "acknowledged" if is_acknowledged else "active"
        if row_state not in allowed_states:
            continue

        current = grouped.get(buyer_id)
        if current is None:
            grouped[buyer_id] = {
                "buyer_id": buyer_id,
                "buyer_display_name": buyer_display_name,
                "alert_delivery_count": 1,
                "latest_alert_delivery_status": str(row.get("delivery_status") or "unknown"),
                "latest_alert_delivery_created_at": created_at,
                "order_exception_count": int(payload.get("order_exception_count") or 0),
                "recent_order_exception_count": int(payload.get("recent_order_exception_count") or 0),
                "latest_order_id": str(payload.get("latest_order_id") or "").strip() or None,
                "latest_order_status": str(payload.get("latest_order_status") or "").strip() or None,
                "risk_level": str(payload.get("risk_level") or "watch").strip() or "watch",
                "alert_reason": str(payload.get("alert_reason") or "").strip()
                or f"{int(payload.get('order_exception_count') or 0)} buyer-triggered order exception alerts in {ORDER_FRAUD_WATCH_LOOKBACK_DAYS} days.",
                "acknowledged": is_acknowledged,
            }
            continue

        current["alert_delivery_count"] = int(current.get("alert_delivery_count", 0)) + 1
        current_created_at = current.get("latest_alert_delivery_created_at")
        if isinstance(current_created_at, datetime) and created_at > current_created_at:
            current["buyer_display_name"] = buyer_display_name
            current["latest_alert_delivery_status"] = str(row.get("delivery_status") or "unknown")
            current["latest_alert_delivery_created_at"] = created_at
            current["order_exception_count"] = int(payload.get("order_exception_count") or 0)
            current["recent_order_exception_count"] = int(payload.get("recent_order_exception_count") or 0)
            current["latest_order_id"] = str(payload.get("latest_order_id") or "").strip() or None
            current["latest_order_status"] = str(payload.get("latest_order_status") or "").strip() or None
            current["risk_level"] = str(payload.get("risk_level") or "watch").strip() or "watch"
            current["alert_reason"] = str(payload.get("alert_reason") or "").strip() or current["alert_reason"]
            current["acknowledged"] = is_acknowledged

    summaries = [OrderFraudWatchBuyerSummaryRead(**summary) for summary in grouped.values()]
    if allowed_states == {"active"}:
        summaries = [summary for summary in summaries if not summary.acknowledged]
    elif allowed_states == {"acknowledged"}:
        summaries = [summary for summary in summaries if summary.acknowledged]
    summaries.sort(
        key=lambda summary: (
            -summary.alert_delivery_count,
            -summary.latest_alert_delivery_created_at.timestamp(),
            summary.buyer_display_name.lower(),
        )
    )
    return summaries[: max(1, min(limit, 20))]


def _order_fraud_watch_risk_level(order_exception_count: int) -> str:
    if order_exception_count >= 6:
        return "critical"
    if order_exception_count >= 4:
        return "elevated"
    return "watch"


def acknowledge_admin_booking_conflict(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_booking_conflict_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_admin_booking_conflict_acknowledgement(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_booking_conflict_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _update_booking_conflict_acknowledgement(
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
                "payload->>alert_type": "eq.booking_conflict",
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
        _insert_booking_conflict_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return [NotificationDeliveryRead(**row) for row in updated_rows]


def _insert_booking_conflict_events(
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
        booking_id = str(payload.get("booking_id") or "").strip()
        listing_id = str(payload.get("listing_id") or "").strip()
        conflict_count = int(payload.get("conflict_count") or 0)
        scheduled_start = str(payload.get("scheduled_start") or "").strip()
        scheduled_end = str(payload.get("scheduled_end") or "").strip()
        if not seller_id or not seller_slug or not seller_display_name or not alert_signature or not booking_id or not listing_id:
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
                "booking_id": booking_id,
                "listing_id": listing_id,
                "conflict_count": conflict_count,
                "scheduled_start": scheduled_start or datetime.now(timezone.utc).isoformat(),
                "scheduled_end": scheduled_end or datetime.now(timezone.utc).isoformat(),
            }
        )

    if not events:
        return

    try:
        supabase.insert("booking_conflict_events", events, use_service_role=True)
    except SupabaseError:
        return


def list_admin_booking_conflict_events(limit: int = 20) -> list[BookingConflictEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "booking_conflict_events",
            query={
                "select": (
                    "id,seller_id,seller_slug,seller_display_name,delivery_id,actor_user_id,"
                    "action,alert_signature,booking_id,listing_id,conflict_count,scheduled_start,scheduled_end,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [BookingConflictEventRead(**row) for row in rows]


def acknowledge_admin_subscription_downgrade(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_subscription_downgrade_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_admin_subscription_downgrade_acknowledgement(
    seller_id: str,
    actor_user_id: str | None = None,
) -> list[NotificationDeliveryRead]:
    return _update_subscription_downgrade_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _update_subscription_downgrade_acknowledgement(
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
                "payload->>alert_type": "eq.subscription_downgrade",
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
        _insert_subscription_downgrade_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return [NotificationDeliveryRead(**row) for row in updated_rows]


def _insert_subscription_downgrade_events(
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
        seller_subscription_id = str(payload.get("seller_subscription_id") or "").strip()
        from_tier_name = str(payload.get("previous_tier_name") or "").strip()
        to_tier_name = str(payload.get("current_tier_name") or "").strip()
        reason_code = str(payload.get("reason_code") or "").strip()
        note = str(payload.get("note") or "").strip()
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
                "seller_subscription_id": seller_subscription_id or None,
                "from_tier_id": str(payload.get("previous_tier_id") or "").strip() or None,
                "from_tier_name": from_tier_name or None,
                "to_tier_id": str(payload.get("current_tier_id") or "").strip() or None,
                "to_tier_name": to_tier_name or None,
                "reason_code": reason_code or None,
                "note": note or None,
            }
        )

    if not events:
        return

    try:
        supabase.insert("subscription_downgrade_events", events, use_service_role=True)
    except SupabaseError:
        return


def list_admin_subscription_downgrade_events(limit: int = 20) -> list[SubscriptionDowngradeEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "subscription_downgrade_events",
            query={
                "select": (
                    "id,seller_id,seller_slug,seller_display_name,delivery_id,actor_user_id,action,"
                    "alert_signature,seller_subscription_id,from_tier_id,from_tier_name,to_tier_id,to_tier_name,"
                    "reason_code,note,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [SubscriptionDowngradeEventRead(**row) for row in rows]


def list_admin_subscription_downgrade_seller_summaries(
    limit: int = 6,
    state: str | None = None,
) -> list[SubscriptionDowngradeSellerSummaryRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
                "payload->>alert_type": "eq.subscription_downgrade",
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    grouped: dict[str, dict[str, object]] = {}
    allowed_states = {"active"} if state is None else {"active", "acknowledged"} if state == "all" else {state}

    for row in rows:
        payload = row.get("payload") or {}
        seller_id = str(payload.get("seller_id") or "").strip()
        seller_slug = str(payload.get("seller_slug") or "").strip()
        seller_display_name = str(payload.get("seller_display_name") or "").strip()
        alert_signature = str(payload.get("alert_signature") or "").strip()
        created_at = _parse_timestamp(row.get("created_at"))
        if not seller_id or not seller_slug or not seller_display_name or not alert_signature or created_at is None:
            continue

        acknowledged_signature = str(payload.get("acknowledged_signature") or "").strip()
        is_acknowledged = bool(acknowledged_signature) and acknowledged_signature == alert_signature
        row_state = "acknowledged" if is_acknowledged else "active"
        if row_state not in allowed_states:
            continue

        current = grouped.get(seller_id)
        if current is None:
            grouped[seller_id] = {
                "seller_id": seller_id,
                "seller_slug": seller_slug,
                "seller_display_name": seller_display_name,
                "alert_delivery_count": 1,
                "latest_alert_delivery_id": row.get("id"),
                "latest_alert_delivery_status": str(row.get("delivery_status") or "unknown"),
                "latest_alert_delivery_created_at": created_at,
                "previous_tier_name": payload.get("previous_tier_name"),
                "current_tier_name": payload.get("current_tier_name"),
                "reason_code": payload.get("reason_code"),
                "acknowledged": is_acknowledged,
            }
            continue

        current["alert_delivery_count"] = int(current.get("alert_delivery_count", 0)) + 1
        current_created_at = current.get("latest_alert_delivery_created_at")
        if isinstance(current_created_at, datetime) and created_at > current_created_at:
            current["latest_alert_delivery_id"] = row.get("id")
            current["latest_alert_delivery_status"] = str(row.get("delivery_status") or "unknown")
            current["latest_alert_delivery_created_at"] = created_at
            current["previous_tier_name"] = payload.get("previous_tier_name")
            current["current_tier_name"] = payload.get("current_tier_name")
            current["reason_code"] = payload.get("reason_code")
            current["acknowledged"] = is_acknowledged

    summaries = [SubscriptionDowngradeSellerSummaryRead(**summary) for summary in grouped.values()]
    summaries.sort(
        key=lambda summary: (
            -summary.alert_delivery_count,
            -summary.latest_alert_delivery_created_at.timestamp(),
            summary.seller_display_name.lower(),
        )
    )
    return summaries[: max(1, min(limit, 20))]
