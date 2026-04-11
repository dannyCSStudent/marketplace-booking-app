from datetime import datetime
from typing import Any

from pydantic import BaseModel


class NotificationDeliveryRead(BaseModel):
    id: str
    recipient_user_id: str
    transaction_kind: str
    transaction_id: str
    event_id: str
    channel: str
    delivery_status: str
    payload: dict[str, Any]
    failure_reason: str | None = None
    attempts: int = 0
    sent_at: datetime | None = None
    created_at: datetime


class NotificationDeliverySummaryRead(BaseModel):
    total_deliveries: int
    queued_deliveries: int
    failed_deliveries: int
    sent_deliveries: int
    email_deliveries: int
    push_deliveries: int
    order_deliveries: int
    booking_deliveries: int
    failed_last_24h: int
    queued_older_than_1h: int
    oldest_queued_created_at: datetime | None = None
    latest_failure_created_at: datetime | None = None


class NotificationWorkerHealthRead(BaseModel):
    email_provider: str
    push_provider: str
    worker_poll_seconds: int
    batch_size: int
    max_attempts: int
    due_queued_deliveries: int
    processing_deliveries: int
    stuck_processing_deliveries: int
    recent_failure_deliveries: int
    oldest_due_queued_created_at: datetime | None = None
    oldest_stuck_processing_last_attempt_at: datetime | None = None


class NotificationDeliveryBulkRetryRequest(BaseModel):
    delivery_ids: list[str]
    execution_mode: str = "best_effort"


class NotificationDeliveryBulkActionFailure(BaseModel):
    id: str
    detail: str


class NotificationDeliveryBulkRetryResult(BaseModel):
    succeeded_ids: list[str]
    failed: list[NotificationDeliveryBulkActionFailure]


class TrustAlertEventRead(BaseModel):
    id: str
    seller_id: str
    seller_slug: str
    seller_display_name: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    risk_level: str
    trend_direction: str
    created_at: datetime


class TrustAlertSellerSummaryRead(BaseModel):
    seller_id: str
    seller_slug: str
    seller_display_name: str
    event_count: int
    latest_event_action: str
    latest_event_risk_level: str
    latest_event_trend_direction: str
    latest_event_created_at: datetime


class ReviewResponseReminderEventRead(BaseModel):
    id: str
    seller_id: str
    seller_slug: str
    seller_display_name: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    latest_review_id: str | None = None
    latest_review_rating: int | None = None
    pending_review_count: int
    created_at: datetime


class ReviewResponseReminderSellerSummaryRead(BaseModel):
    seller_id: str
    seller_slug: str
    seller_display_name: str
    reminder_count: int
    latest_review_id: str | None = None
    latest_review_rating: int | None = None
    latest_alert_delivery_status: str
    latest_alert_delivery_created_at: datetime
    acknowledged: bool


class OrderExceptionSellerSummaryRead(BaseModel):
    seller_id: str
    seller_slug: str
    seller_display_name: str
    event_count: int
    latest_event_action: str
    latest_event_status: str
    latest_event_created_at: datetime


class OrderExceptionEventRead(BaseModel):
    id: str
    seller_id: str
    seller_slug: str
    seller_display_name: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    order_id: str
    order_status: str
    created_at: datetime


class OrderFraudWatchBuyerSummaryRead(BaseModel):
    buyer_id: str
    buyer_display_name: str
    alert_delivery_count: int
    latest_alert_delivery_status: str
    latest_alert_delivery_created_at: datetime
    order_exception_count: int
    recent_order_exception_count: int
    risk_level: str
    alert_reason: str
    latest_order_id: str | None = None
    latest_order_status: str | None = None
    acknowledged: bool


class OrderFraudWatchEventRead(BaseModel):
    id: str
    buyer_id: str
    buyer_display_name: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    order_exception_count: int
    recent_order_exception_count: int
    risk_level: str
    latest_order_id: str | None = None
    latest_order_status: str | None = None
    created_at: datetime


class BookingConflictSellerSummaryRead(BaseModel):
    seller_id: str
    seller_slug: str
    seller_display_name: str
    event_count: int
    latest_event_action: str
    latest_event_status: str
    latest_event_created_at: datetime


class BookingConflictEventRead(BaseModel):
    id: str
    seller_id: str
    seller_slug: str
    seller_display_name: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    booking_id: str
    listing_id: str
    conflict_count: int
    scheduled_start: datetime
    scheduled_end: datetime
    created_at: datetime


class DeliveryFailureSummaryRead(BaseModel):
    failed_delivery_id: str
    transaction_kind: str
    transaction_id: str
    failed_delivery_channel: str
    failed_delivery_status: str
    failed_delivery_attempts: int
    failed_delivery_reason: str
    original_recipient_user_id: str | None = None
    alert_delivery_count: int
    latest_alert_delivery_status: str
    latest_alert_delivery_created_at: datetime
    acknowledged: bool


class DeliveryFailureEventRead(BaseModel):
    id: str
    failed_delivery_id: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    failed_delivery_channel: str
    failed_delivery_status: str
    failed_delivery_attempts: int
    failed_delivery_reason: str
    original_recipient_user_id: str | None = None
    created_at: datetime


class InventoryAlertSummaryRead(BaseModel):
    seller_id: str
    seller_slug: str
    seller_display_name: str
    listing_id: str
    listing_title: str
    inventory_bucket: str
    inventory_count: int | None = None
    alert_delivery_count: int
    latest_alert_delivery_status: str
    latest_alert_delivery_created_at: datetime
    acknowledged: bool


class InventoryAlertEventRead(BaseModel):
    id: str
    seller_id: str
    seller_slug: str
    seller_display_name: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    listing_id: str
    listing_title: str
    inventory_bucket: str
    inventory_count: int | None = None
    created_at: datetime


class SubscriptionDowngradeSellerSummaryRead(BaseModel):
    seller_id: str
    seller_slug: str
    seller_display_name: str
    alert_delivery_count: int
    latest_alert_delivery_id: str | None = None
    latest_alert_delivery_status: str
    latest_alert_delivery_created_at: datetime
    previous_tier_name: str | None = None
    current_tier_name: str | None = None
    reason_code: str | None = None
    acknowledged: bool


class SubscriptionDowngradeEventRead(BaseModel):
    id: str
    seller_id: str
    seller_slug: str
    seller_display_name: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    seller_subscription_id: str | None = None
    from_tier_id: str | None = None
    from_tier_name: str | None = None
    to_tier_id: str | None = None
    to_tier_name: str | None = None
    reason_code: str | None = None
    note: str | None = None
    created_at: datetime


class SellerProfileCompletionEventRead(BaseModel):
    id: str
    seller_id: str
    seller_slug: str
    seller_display_name: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    completion_percent: int
    missing_fields: list[str]
    summary: str
    created_at: datetime
