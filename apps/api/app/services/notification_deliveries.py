from fastapi import HTTPException

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.notifications import NotificationDeliveryRead


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
