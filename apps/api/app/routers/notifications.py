from fastapi import APIRouter, Depends

from app.dependencies.auth import get_current_user
from app.schemas.notifications import NotificationDeliveryRead
from app.services.notification_deliveries import get_my_notification_deliveries

router = APIRouter()


@router.get("/me", response_model=list[NotificationDeliveryRead])
def read_my_notification_deliveries(
    current_user=Depends(get_current_user),
) -> list[NotificationDeliveryRead]:
    return get_my_notification_deliveries(current_user)
