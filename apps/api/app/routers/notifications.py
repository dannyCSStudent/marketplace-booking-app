from fastapi import APIRouter, Depends

from app.dependencies.admin import require_admin_user
from app.dependencies.auth import get_current_user
from app.schemas.notifications import (
    NotificationDeliveryBulkRetryRequest,
    NotificationDeliveryBulkRetryResult,
    NotificationDeliveryRead,
    NotificationDeliverySummaryRead,
    NotificationWorkerHealthRead,
    TrustAlertEventRead,
    TrustAlertSellerSummaryRead,
)
from app.services.notification_deliveries import (
    acknowledge_admin_trust_alert,
    clear_admin_trust_alert_acknowledgement,
    get_admin_notification_deliveries,
    get_admin_notification_delivery_summary,
    get_admin_notification_worker_health,
    get_my_notification_deliveries,
    list_admin_trust_alert_events,
    list_admin_trust_alert_seller_summaries,
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


@router.post("/admin/trust-alerts/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def acknowledge_trust_alert(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return acknowledge_admin_trust_alert(seller_id, actor_user_id=current_user.id)


@router.delete("/admin/trust-alerts/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def clear_trust_alert_acknowledgement(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return clear_admin_trust_alert_acknowledgement(seller_id, actor_user_id=current_user.id)


@router.get("/admin/trust-alerts/events", response_model=list[TrustAlertEventRead])
def read_admin_trust_alert_events(
    limit: int = 20,
    current_user=Depends(require_admin_user),
) -> list[TrustAlertEventRead]:
    return list_admin_trust_alert_events(limit=limit)


@router.get("/admin/trust-alerts/sellers", response_model=list[TrustAlertSellerSummaryRead])
def read_admin_trust_alert_sellers(
    limit: int = 8,
    action: str | None = None,
    current_user=Depends(require_admin_user),
) -> list[TrustAlertSellerSummaryRead]:
    return list_admin_trust_alert_seller_summaries(limit=limit, action=action)


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
