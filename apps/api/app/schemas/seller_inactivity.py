from datetime import datetime

from pydantic import BaseModel


class SellerInactivitySummaryRead(BaseModel):
    seller_id: str
    seller_slug: str
    seller_display_name: str
    severity: str = "monitor"
    tone: str = "sky"
    action_label: str = "Review seller activity"
    alert_reason: str
    last_active_at: datetime | None = None
    last_active_kind: str = "seller profile update"
    idle_days: int = 0
    alert_delivery_count: int = 0
    latest_alert_delivery_status: str = "unknown"
    latest_alert_delivery_created_at: datetime
    acknowledged: bool = False


class SellerInactivityEventRead(BaseModel):
    id: str
    seller_id: str
    seller_slug: str
    seller_display_name: str
    delivery_id: str | None = None
    actor_user_id: str
    action: str
    alert_signature: str
    last_active_at: datetime | None = None
    last_active_kind: str
    idle_days: int = 0
    created_at: datetime
