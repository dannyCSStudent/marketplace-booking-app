from pydantic import BaseModel, Field

class SellerTrustScoreRead(BaseModel):
    score: int
    label: str
    summary: str
    risk_level: str = "watch"
    trend_direction: str = "steady"
    trend_summary: str = "Trust score is steady versus the previous window."
    trend_delta: int = 0
    risk_reasons: list[str] = Field(default_factory=list)
    review_quality_score: int = 0
    response_rate_score: int = 0
    completion_score: int = 0
    delivery_reliability_score: int = 0
    verified_bonus: int = 0
    review_count: int = 0
    response_rate: float = 0
    completion_rate: float = 0
    delivery_success_rate: float = 0
    hidden_review_count: int = 0
    completed_transactions: int = 0
    total_transactions: int = 0

class SellerCreate(BaseModel):
    display_name: str
    slug: str
    bio: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    accepts_custom_orders: bool = True

class SellerUpdate(BaseModel):
    display_name: str | None = None
    slug: str | None = None
    bio: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    accepts_custom_orders: bool | None = None

class SellerRead(BaseModel):
    id: str
    user_id: str
    display_name: str
    slug: str
    bio: str | None = None
    is_verified: bool = False
    city: str | None = None
    state: str | None = None
    country: str | None = None
    accepts_custom_orders: bool = True
    average_rating: float = 0
    review_count: int = 0
    trust_score: SellerTrustScoreRead | None = None


class SellerTrustInterventionRead(BaseModel):
    seller: SellerRead
    risk_level: str
    trend_direction: str
    trend_summary: str
    intervention_reason: str
    intervention_priority: str = "medium"
    intervention_lane: str = "seller_trust_intervention"


class SellerLookupRead(BaseModel):
    id: str
    display_name: str
    slug: str
    is_verified: bool = False
    city: str | None = None
    state: str | None = None
    country: str | None = None
