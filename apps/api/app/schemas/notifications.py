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
