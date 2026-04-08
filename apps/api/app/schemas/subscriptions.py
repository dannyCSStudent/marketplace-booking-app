from datetime import datetime
from typing import Literal

from pydantic import BaseModel


SubscriptionChangeReasonCode = Literal[
    "trial_conversion",
    "manual_upgrade",
    "retention_save",
    "support_adjustment",
    "plan_reset",
]


class SubscriptionTierRead(BaseModel):
    id: str | None = None
    code: str
    name: str
    monthly_price_cents: int = 0
    perks_summary: str | None = None
    analytics_enabled: bool = False
    priority_visibility: bool = False
    premium_storefront: bool = False
    is_active: bool = True
    created_at: datetime | None = None


class SubscriptionTierCreate(BaseModel):
    code: str
    name: str
    monthly_price_cents: int = 0
    perks_summary: str | None = None
    analytics_enabled: bool = False
    priority_visibility: bool = False
    premium_storefront: bool = False
    is_active: bool = True


class SellerSubscriptionRead(BaseModel):
    id: str | None = None
    seller_id: str
    seller_slug: str | None = None
    seller_display_name: str | None = None
    tier_id: str
    tier_code: str | None = None
    tier_name: str | None = None
    monthly_price_cents: int = 0
    perks_summary: str | None = None
    analytics_enabled: bool = False
    priority_visibility: bool = False
    premium_storefront: bool = False
    started_at: datetime | None = None
    ended_at: datetime | None = None
    is_active: bool = True
    created_at: datetime | None = None


class SellerSubscriptionAssign(BaseModel):
    seller_slug: str
    tier_id: str
    reason_code: SubscriptionChangeReasonCode
    note: str | None = None


class SellerSubscriptionEventRead(BaseModel):
    id: str | None = None
    seller_id: str
    seller_slug: str | None = None
    seller_display_name: str | None = None
    seller_subscription_id: str | None = None
    actor_user_id: str
    actor_name: str | None = None
    action: str
    reason_code: SubscriptionChangeReasonCode | None = None
    from_tier_id: str | None = None
    from_tier_code: str | None = None
    from_tier_name: str | None = None
    to_tier_id: str | None = None
    to_tier_code: str | None = None
    to_tier_name: str | None = None
    note: str | None = None
    created_at: datetime | None = None
