import json
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import get_settings
from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client


def process_notification_deliveries(*, batch_size: int = 25) -> dict[str, int]:
    settings = get_settings()
    deliveries = _load_due_deliveries(batch_size=batch_size)
    processed = 0
    sent = 0
    failed = 0

    for delivery in deliveries:
        processed += 1
        delivery_id = delivery["id"]
        attempts = int(delivery.get("attempts") or 0) + 1
        _mark_processing(delivery_id=delivery_id, attempts=attempts)

        try:
            _dispatch_delivery(delivery=delivery, settings=settings)
            _mark_sent(delivery_id=delivery_id, attempts=attempts)
            sent += 1
        except Exception as exc:
            should_fail_permanently = attempts >= settings.notification_max_attempts
            _mark_failed(
                delivery_id=delivery_id,
                attempts=attempts,
                error_message=str(exc),
                final=should_fail_permanently,
            )
            failed += 1

    return {
        "processed": processed,
        "sent": sent,
        "failed": failed,
    }


def _load_due_deliveries(*, batch_size: int) -> list[dict[str, Any]]:
    supabase = get_supabase_client()
    now = datetime.now(timezone.utc).isoformat()
    try:
        return supabase.select(
            "notification_deliveries",
            query={
                "select": "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,payload,attempts,next_attempt_at",
                "delivery_status": "eq.queued",
                "next_attempt_at": f"lte.{now}",
                "order": "created_at.asc",
                "limit": str(batch_size),
            },
            use_service_role=True,
        )
    except SupabaseError:
        return []


def _mark_processing(*, delivery_id: str, attempts: int) -> None:
    supabase = get_supabase_client()
    supabase.update(
        "notification_deliveries",
        {
            "delivery_status": "processing",
            "attempts": attempts,
            "last_attempt_at": datetime.now(timezone.utc).isoformat(),
            "failure_reason": None,
        },
        query={"id": f"eq.{delivery_id}"},
        use_service_role=True,
    )


def _mark_sent(*, delivery_id: str, attempts: int) -> None:
    supabase = get_supabase_client()
    supabase.update(
        "notification_deliveries",
        {
            "delivery_status": "sent",
            "attempts": attempts,
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "failure_reason": None,
        },
        query={"id": f"eq.{delivery_id}"},
        use_service_role=True,
    )


def _mark_failed(*, delivery_id: str, attempts: int, error_message: str, final: bool) -> None:
    supabase = get_supabase_client()
    next_attempt_at = (
        datetime.now(timezone.utc).isoformat()
        if final
        else (datetime.now(timezone.utc) + timedelta(minutes=5 * attempts)).isoformat()
    )
    supabase.update(
        "notification_deliveries",
        {
            "delivery_status": "failed" if final else "queued",
            "attempts": attempts,
            "failure_reason": error_message[:500],
            "next_attempt_at": next_attempt_at,
        },
        query={"id": f"eq.{delivery_id}"},
        use_service_role=True,
    )


def _dispatch_delivery(*, delivery: dict[str, Any], settings) -> None:
    channel = delivery["channel"]
    provider = (
        settings.notification_email_provider
        if channel == "email"
        else settings.notification_push_provider
    )

    if provider == "log":
        print(
            json.dumps(
                {
                    "type": "notification_delivery",
                    "channel": channel,
                    "recipient_user_id": delivery["recipient_user_id"],
                    "payload": delivery.get("payload") or {},
                }
            )
        )
        return

    if provider == "webhook":
        webhook_url = (
            settings.notification_email_webhook_url
            if channel == "email"
            else settings.notification_push_webhook_url
        )
        if not webhook_url:
            raise RuntimeError(f"{channel} webhook URL is not configured")
        _post_webhook(webhook_url=webhook_url, delivery=delivery)
        return

    if provider == "resend":
        if channel != "email":
            raise RuntimeError("Resend only supports email deliveries")
        _send_resend_email(delivery=delivery, settings=settings)
        return

    raise RuntimeError(f"Unsupported notification provider: {provider}")


def _send_resend_email(*, delivery: dict[str, Any], settings) -> None:
    if not settings.resend_api_key:
        raise RuntimeError("RESEND_API_KEY is not configured")

    if not settings.notification_from_email:
        raise RuntimeError("NOTIFICATION_FROM_EMAIL is not configured")

    payload = delivery.get("payload") or {}
    to_email = payload.get("to") or _get_recipient_email(delivery["recipient_user_id"])
    subject = payload.get("subject")
    html = payload.get("html")

    if not to_email:
        raise RuntimeError("Notification payload missing email recipient: 'to'")
    if not subject:
        raise RuntimeError("Notification payload missing subject")
    if not html:
        raise RuntimeError("Notification payload missing html body")

    request = Request(
        url="https://api.resend.com/emails",
        data=json.dumps(
            {
                "from": settings.notification_from_email,
                "to": [to_email],
                "subject": subject,
                "html": html,
            }
        ).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
            "User-Agent": "marketplace-booking-app/0.1",
        },
        method="POST",
    )
    try:
        with urlopen(request) as response:
            response.read()
    except HTTPError as exc:
        raw_body = exc.read().decode("utf-8")
        detail = raw_body or f"status {exc.code}"
        raise RuntimeError(f"Resend delivery failed with status {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Resend delivery failed: {exc.reason}") from exc


def _get_recipient_email(recipient_user_id: str) -> str:
    supabase = get_supabase_client()
    try:
        user = supabase.get_auth_user(recipient_user_id)
    except SupabaseError as exc:
        raise RuntimeError(f"Unable to resolve recipient email: {exc.detail}") from exc

    email = user.get("email")
    if not email:
        raise RuntimeError("Notification recipient email is not available")

    return email


def _post_webhook(*, webhook_url: str, delivery: dict[str, Any]) -> None:
    request = Request(
        url=webhook_url,
        data=json.dumps(delivery).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request) as response:
            response.read()
    except HTTPError as exc:
        raw_body = exc.read().decode("utf-8")
        detail = raw_body or f"status {exc.code}"
        raise RuntimeError(f"Webhook delivery failed with status {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Webhook delivery failed: {exc.reason}") from exc
