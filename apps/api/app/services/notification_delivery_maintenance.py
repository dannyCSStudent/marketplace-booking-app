from datetime import datetime, timedelta, timezone

from app.core.config import get_settings
from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client


def prune_notification_deliveries() -> dict[str, int]:
    settings = get_settings()
    supabase = get_supabase_client()

    sent_before = (
        datetime.now(timezone.utc) - timedelta(days=settings.notification_sent_retention_days)
    ).isoformat()
    failed_before = (
        datetime.now(timezone.utc) - timedelta(days=settings.notification_failed_retention_days)
    ).isoformat()

    deleted_sent = _delete_matching_deliveries(
        supabase,
        status_value="sent",
        before_field="sent_at",
        before_value=sent_before,
    )
    deleted_failed = _delete_matching_deliveries(
        supabase,
        status_value="failed",
        before_field="created_at",
        before_value=failed_before,
    )

    return {
        "deleted_sent": deleted_sent,
        "deleted_failed": deleted_failed,
        "deleted_total": deleted_sent + deleted_failed,
    }


def _delete_matching_deliveries(supabase, *, status_value: str, before_field: str, before_value: str) -> int:
    try:
        rows = supabase.delete(
            "notification_deliveries",
            query={
                "delivery_status": f"eq.{status_value}",
                before_field: f"lt.{before_value}",
                "select": "id",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return 0

    return len(rows or [])
