from datetime import datetime
from typing import Literal

from pydantic import BaseModel

MonetizationWatchlistSeverity = Literal["high", "medium", "monitor"]
MonetizationWatchlistTone = Literal["amber", "rose", "sky"]
MonetizationWatchlistReplayKey = Literal[
    "subscription_destructive",
    "subscription_downgrade",
    "promotion_removals",
    "promoted_listings",
]


class MonetizationWatchlistAlertRead(BaseModel):
    id: str
    signature: str
    title: str
    detail: str
    severity: MonetizationWatchlistSeverity = "monitor"
    tone: MonetizationWatchlistTone = "sky"
    action_label: str
    replay_key: MonetizationWatchlistReplayKey
    created_at: datetime | None = None


class MonetizationWatchlistSummaryRead(BaseModel):
    id: str
    signature: str
    title: str
    detail: str
    severity: MonetizationWatchlistSeverity = "monitor"
    tone: MonetizationWatchlistTone = "sky"
    action_label: str
    replay_key: MonetizationWatchlistReplayKey
    acknowledged: bool = False
    latest_action: str = "active"
    latest_action_at: datetime | None = None
    created_at: datetime | None = None


class MonetizationWatchlistEventRead(BaseModel):
    id: str
    alert_id: str
    alert_signature: str
    actor_user_id: str
    action: str
    alert_title: str
    alert_severity: MonetizationWatchlistSeverity = "monitor"
    created_at: datetime
