from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client


def queue_transaction_notification_jobs(
    *,
    recipient_user_id: str | None,
    transaction_kind: str,
    transaction_id: str,
    event_id: str,
    status_value: str,
    actor_role: str,
    note: str | None,
) -> None:
    if not recipient_user_id:
        return

    supabase = get_supabase_client()
    try:
        profile = supabase.select(
            "profiles",
            query={
                "select": "id,email_notifications_enabled,push_notifications_enabled",
                "id": f"eq.{recipient_user_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            return
        raise

    deliveries: list[dict] = []
    base_payload = _build_delivery_payload(
        transaction_kind=transaction_kind,
        transaction_id=transaction_id,
        status_value=status_value,
        actor_role=actor_role,
        note=note,
    )
    payload = {
        **base_payload,
    }

    if profile.get("email_notifications_enabled", True):
        deliveries.append(
            {
                "recipient_user_id": recipient_user_id,
                "transaction_kind": transaction_kind,
                "transaction_id": transaction_id,
                "event_id": event_id,
                "channel": "email",
                "delivery_status": "queued",
                "payload": payload,
            }
        )

    if profile.get("push_notifications_enabled", True):
        deliveries.append(
            {
                "recipient_user_id": recipient_user_id,
                "transaction_kind": transaction_kind,
                "transaction_id": transaction_id,
                "event_id": event_id,
                "channel": "push",
                "delivery_status": "queued",
                "payload": payload,
            }
        )

    if deliveries:
        supabase.insert(
            "notification_deliveries",
            deliveries,
            use_service_role=True,
        )


def _build_delivery_payload(
    *,
    transaction_kind: str,
    transaction_id: str,
    status_value: str,
    actor_role: str,
    note: str | None,
) -> dict:
    status_label = status_value.replace("_", " ")
    transaction_label = "order" if transaction_kind == "order" else "booking"
    subject = f"Your {transaction_label} is now {status_label}"
    message = note or f"Your {transaction_label} moved to {status_label}."
    html = (
        f"<p>Status update for your {transaction_label}.</p>"
        f"<p><strong>Status:</strong> {status_label}</p>"
        f"<p><strong>Transaction ID:</strong> {transaction_id}</p>"
        f"<p>{message}</p>"
    )

    return {
        "transaction_kind": transaction_kind,
        "transaction_id": transaction_id,
        "status": status_value,
        "actor_role": actor_role,
        "note": note,
        "subject": subject,
        "body": message,
        "html": html,
    }
