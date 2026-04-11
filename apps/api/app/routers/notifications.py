from fastapi import APIRouter, Depends

from app.dependencies.admin import require_admin_user
from app.dependencies.auth import get_current_user
from app.schemas.notifications import (
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
    SubscriptionDowngradeEventRead,
    SubscriptionDowngradeSellerSummaryRead,
    TrustAlertEventRead,
    TrustAlertSellerSummaryRead,
)
from app.services.notification_deliveries import (
    acknowledge_admin_order_exception,
    acknowledge_admin_booking_conflict,
    acknowledge_admin_delivery_failure,
    acknowledge_admin_trust_alert,
    acknowledge_admin_review_response_reminder,
    clear_admin_trust_alert_acknowledgement,
    clear_admin_order_exception_acknowledgement,
    clear_admin_booking_conflict_acknowledgement,
    clear_admin_delivery_failure_acknowledgement,
    acknowledge_admin_inventory_alert,
    clear_admin_inventory_alert_acknowledgement,
    clear_admin_review_response_reminder_acknowledgement,
    acknowledge_admin_subscription_downgrade,
    clear_admin_subscription_downgrade_acknowledgement,
    get_admin_notification_deliveries,
    get_admin_notification_delivery_summary,
    get_admin_notification_worker_health,
    get_my_notification_deliveries,
    list_admin_delivery_failure_events,
    list_admin_delivery_failure_summaries,
    list_admin_inventory_alert_events,
    list_admin_inventory_alert_summaries,
    list_admin_review_response_reminder_events,
    list_admin_review_response_reminder_seller_summaries,
    list_admin_booking_conflict_events,
    list_admin_booking_conflict_seller_summaries,
    list_admin_subscription_downgrade_events,
    list_admin_subscription_downgrade_seller_summaries,
    list_admin_order_exception_events,
    list_admin_trust_alert_events,
    list_admin_trust_alert_seller_summaries,
    list_admin_order_exception_seller_summaries,
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


@router.get("/admin/delivery-failures/summaries", response_model=list[DeliveryFailureSummaryRead])
def read_admin_delivery_failure_summaries(
    limit: int = 6,
    state: str | None = None,
    current_user=Depends(require_admin_user),
) -> list[DeliveryFailureSummaryRead]:
    return list_admin_delivery_failure_summaries(limit=limit, state=state)


@router.get("/admin/review-response-reminders/summaries", response_model=list[ReviewResponseReminderSellerSummaryRead])
def read_admin_review_response_reminder_summaries(
    limit: int = 8,
    state: str | None = None,
    current_user=Depends(require_admin_user),
) -> list[ReviewResponseReminderSellerSummaryRead]:
    return list_admin_review_response_reminder_seller_summaries(limit=limit, state=state)


@router.get("/admin/review-response-reminders/events", response_model=list[ReviewResponseReminderEventRead])
def read_admin_review_response_reminder_events(
    limit: int = 20,
    current_user=Depends(require_admin_user),
) -> list[ReviewResponseReminderEventRead]:
    return list_admin_review_response_reminder_events(limit=limit)


@router.post("/admin/review-response-reminders/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def acknowledge_review_response_reminder(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return acknowledge_admin_review_response_reminder(seller_id, actor_user_id=current_user.id)


@router.delete("/admin/review-response-reminders/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def clear_review_response_reminder_acknowledgement(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return clear_admin_review_response_reminder_acknowledgement(seller_id, actor_user_id=current_user.id)


@router.get("/admin/delivery-failures/events", response_model=list[DeliveryFailureEventRead])
def read_admin_delivery_failure_events(
    limit: int = 20,
    current_user=Depends(require_admin_user),
) -> list[DeliveryFailureEventRead]:
    return list_admin_delivery_failure_events(limit=limit)


@router.post("/admin/delivery-failures/{failed_delivery_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def acknowledge_delivery_failure(
    failed_delivery_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return acknowledge_admin_delivery_failure(failed_delivery_id, actor_user_id=current_user.id)


@router.delete("/admin/delivery-failures/{failed_delivery_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def clear_delivery_failure_acknowledgement(
    failed_delivery_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return clear_admin_delivery_failure_acknowledgement(failed_delivery_id, actor_user_id=current_user.id)


@router.get("/admin/inventory-alerts/summaries", response_model=list[InventoryAlertSummaryRead])
def read_admin_inventory_alert_summaries(
    limit: int = 8,
    state: str | None = None,
    current_user=Depends(require_admin_user),
) -> list[InventoryAlertSummaryRead]:
    return list_admin_inventory_alert_summaries(limit=limit, state=state)


@router.get("/admin/inventory-alerts/events", response_model=list[InventoryAlertEventRead])
def read_admin_inventory_alert_events(
    limit: int = 20,
    current_user=Depends(require_admin_user),
) -> list[InventoryAlertEventRead]:
    return list_admin_inventory_alert_events(limit=limit)


@router.post("/admin/inventory-alerts/{seller_id}/{listing_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def acknowledge_inventory_alert(
    seller_id: str,
    listing_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return acknowledge_admin_inventory_alert(
        seller_id,
        listing_id,
        actor_user_id=current_user.id,
    )


@router.delete("/admin/inventory-alerts/{seller_id}/{listing_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def clear_inventory_alert_acknowledgement(
    seller_id: str,
    listing_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return clear_admin_inventory_alert_acknowledgement(
        seller_id,
        listing_id,
        actor_user_id=current_user.id,
    )


@router.get("/admin/subscription-downgrades/sellers", response_model=list[SubscriptionDowngradeSellerSummaryRead])
def read_admin_subscription_downgrade_sellers(
    limit: int = 6,
    state: str | None = None,
    current_user=Depends(require_admin_user),
) -> list[SubscriptionDowngradeSellerSummaryRead]:
    return list_admin_subscription_downgrade_seller_summaries(limit=limit, state=state)


@router.get("/admin/subscription-downgrades/events", response_model=list[SubscriptionDowngradeEventRead])
def read_admin_subscription_downgrade_events(
    limit: int = 20,
    current_user=Depends(require_admin_user),
) -> list[SubscriptionDowngradeEventRead]:
    return list_admin_subscription_downgrade_events(limit=limit)


@router.post("/admin/subscription-downgrades/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def acknowledge_subscription_downgrade(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return acknowledge_admin_subscription_downgrade(seller_id, actor_user_id=current_user.id)


@router.delete("/admin/subscription-downgrades/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def clear_subscription_downgrade_acknowledgement(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return clear_admin_subscription_downgrade_acknowledgement(seller_id, actor_user_id=current_user.id)


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


@router.get("/admin/order-exceptions/sellers", response_model=list[OrderExceptionSellerSummaryRead])
def read_admin_order_exception_sellers(
    limit: int = 6,
    action: str | None = None,
    current_user=Depends(require_admin_user),
) -> list[OrderExceptionSellerSummaryRead]:
    return list_admin_order_exception_seller_summaries(limit=limit, action=action)


@router.post("/admin/order-exceptions/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def acknowledge_order_exception(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return acknowledge_admin_order_exception(seller_id, actor_user_id=current_user.id)


@router.delete("/admin/order-exceptions/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def clear_order_exception_acknowledgement(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return clear_admin_order_exception_acknowledgement(seller_id, actor_user_id=current_user.id)


@router.get("/admin/order-exceptions/events", response_model=list[OrderExceptionEventRead])
def read_admin_order_exception_events(
    limit: int = 20,
    current_user=Depends(require_admin_user),
) -> list[OrderExceptionEventRead]:
    return list_admin_order_exception_events(limit=limit)


@router.get("/admin/booking-conflicts/sellers", response_model=list[BookingConflictSellerSummaryRead])
def read_admin_booking_conflict_sellers(
    limit: int = 6,
    action: str | None = None,
    current_user=Depends(require_admin_user),
) -> list[BookingConflictSellerSummaryRead]:
    return list_admin_booking_conflict_seller_summaries(limit=limit, action=action)


@router.post("/admin/booking-conflicts/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def acknowledge_booking_conflict(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return acknowledge_admin_booking_conflict(seller_id, actor_user_id=current_user.id)


@router.delete("/admin/booking-conflicts/{seller_id}/acknowledge", response_model=list[NotificationDeliveryRead])
def clear_booking_conflict_acknowledgement(
    seller_id: str,
    current_user=Depends(require_admin_user),
) -> list[NotificationDeliveryRead]:
    return clear_admin_booking_conflict_acknowledgement(seller_id, actor_user_id=current_user.id)


@router.get("/admin/booking-conflicts/events", response_model=list[BookingConflictEventRead])
def read_admin_booking_conflict_events(
    limit: int = 20,
    current_user=Depends(require_admin_user),
) -> list[BookingConflictEventRead]:
    return list_admin_booking_conflict_events(limit=limit)


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
