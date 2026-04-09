from fastapi import APIRouter, Depends

from app.dependencies.admin import require_admin_user
from app.dependencies.auth import get_current_user
from app.schemas.notifications import (
    NotificationDeliveryBulkRetryRequest,
    NotificationDeliveryBulkRetryResult,
    NotificationDeliveryRead,
    NotificationDeliverySummaryRead,
    NotificationWorkerHealthRead,
)
from app.services.notification_deliveries import (
    get_admin_notification_deliveries,
    get_admin_notification_delivery_summary,
    get_admin_notification_worker_health,
    get_my_notification_deliveries,
    retry_admin_notification_deliveries,
    retry_admin_notification_delivery,
    retry_my_notification_deliveries,
    retry_my_notification_delivery,
)

router = APIRouter()


@router.get("/me", response_model=list[NotificationDeliveryRead])
def read_my_notification_deliveries(
    current_user=Depends(get_current_user),
) -> list[NotificationDeliveryRead]:
    return get_my_notification_deliveries(current_user)


@router.get("/admin", response_model=list[NotificationDeliveryRead])
def read_admin_notification_deliveries(
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return get_admin_notification_deliveries()


@router.get("/admin/summary", response_model=NotificationDeliverySummaryRead)
def read_admin_notification_delivery_summary(
    current_user=Depends(require_admin_user),
) -> NotificationDeliverySummaryRead:
    return get_admin_notification_delivery_summary()


@router.get("/admin/worker-health", response_model=NotificationWorkerHealthRead)
def read_admin_notification_worker_health(
    current_user=Depends(require_admin_user),
) -> NotificationWorkerHealthRead:
    return get_admin_notification_worker_health()


@router.post("/admin/bulk-retry", response_model=NotificationDeliveryBulkRetryResult)
def bulk_retry_admin_notification_deliveries(
    payload: NotificationDeliveryBulkRetryRequest,
    current_user=Depends(require_admin_user),
) -> NotificationDeliveryBulkRetryResult:
    return retry_admin_notification_deliveries(payload)


@router.post("/admin/{delivery_id}/retry", response_model=NotificationDeliveryRead)
def retry_admin_delivery(
    delivery_id: str,
    current_user=Depends(require_admin_user),
) -> NotificationDeliveryRead:
    return retry_admin_notification_delivery(delivery_id)


@router.post("/{delivery_id}/retry", response_model=NotificationDeliveryRead)
def retry_notification_delivery(
    delivery_id: str,
    current_user=Depends(get_current_user),
) -> NotificationDeliveryRead:
    return retry_my_notification_delivery(current_user, delivery_id)


@router.post("/bulk-retry", response_model=NotificationDeliveryBulkRetryResult)
def bulk_retry_notification_deliveries(
    payload: NotificationDeliveryBulkRetryRequest,
    current_user=Depends(get_current_user),
) -> NotificationDeliveryBulkRetryResult:
    return retry_my_notification_deliveries(current_user, payload)
