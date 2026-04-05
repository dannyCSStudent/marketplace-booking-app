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


class NotificationDeliveryBulkRetryRequest(BaseModel):
    delivery_ids: list[str]
    execution_mode: str = "best_effort"


class NotificationDeliveryBulkActionFailure(BaseModel):
    id: str
    detail: str


class NotificationDeliveryBulkRetryResult(BaseModel):
    succeeded_ids: list[str]
    failed: list[NotificationDeliveryBulkActionFailure]
