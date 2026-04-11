from enum import Enum

from pydantic import BaseModel


class ListingType(str, Enum):
    product = "product"
    service = "service"
    hybrid = "hybrid"

class ListingQueryParams(BaseModel):
    query: str | None = None
    category: str | None = None
    type: ListingType | None = None
    promoted: bool | None = None
    limit: int | None = None
    offset: int | None = None

class ListingCreate(BaseModel):
    seller_id: str
    category_id: str | None = None
    title: str
    slug: str | None = None
    description: str | None = None
    type: ListingType
    status: str = "draft"
    price_cents: int | None = None
    currency: str = "USD"
    inventory_count: int | None = None
    requires_booking: bool = False
    duration_minutes: int | None = None
    is_local_only: bool = True
    city: str | None = None
    state: str | None = None
    country: str | None = None
    pickup_enabled: bool = False
    meetup_enabled: bool = False
    delivery_enabled: bool = False
    shipping_enabled: bool = False
    lead_time_hours: int | None = None
    is_promoted: bool = False
    auto_accept_bookings: bool = False

class ListingUpdate(BaseModel):
    category_id: str | None = None
    title: str | None = None
    slug: str | None = None
    description: str | None = None
    type: ListingType | None = None
    status: str | None = None
    price_cents: int | None = None
    currency: str | None = None
    inventory_count: int | None = None
    requires_booking: bool | None = None
    duration_minutes: int | None = None
    is_local_only: bool | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    pickup_enabled: bool | None = None
    meetup_enabled: bool | None = None
    delivery_enabled: bool | None = None
    shipping_enabled: bool | None = None
    lead_time_hours: int | None = None
    is_promoted: bool | None = None
    auto_accept_bookings: bool | None = None

class ListingImageCreate(BaseModel):
    image_url: str
    alt_text: str | None = None
    sort_order: int | None = None

class ListingImageUploadCreate(BaseModel):
    filename: str
    content_type: str
    base64_data: str
    alt_text: str | None = None

class ListingImageRead(BaseModel):
    id: str
    listing_id: str
    image_url: str
    alt_text: str | None = None
    sort_order: int = 0
    created_at: str

class ListingRead(BaseModel):
    id: str
    seller_id: str
    category_id: str | None = None
    category: str | None = None
    title: str
    slug: str
    description: str | None = None
    type: ListingType
    status: str
    price_cents: int | None = None
    currency: str = "USD"
    inventory_count: int | None = None
    requires_booking: bool = False
    duration_minutes: int | None = None
    is_local_only: bool = True
    city: str | None = None
    state: str | None = None
    country: str | None = None
    pickup_enabled: bool = False
    meetup_enabled: bool = False
    delivery_enabled: bool = False
    shipping_enabled: bool = False
    lead_time_hours: int | None = None
    images: list[ListingImageRead] = []
    created_at: str
    updated_at: str
    last_operating_adjustment_at: str | None = None
    last_operating_adjustment_summary: str | None = None
    last_pricing_comparison_scope: str | None = None
    available_today: bool = False
    is_new_listing: bool = False
    recent_transaction_count: int = 0
    is_promoted: bool = False
    auto_accept_bookings: bool = False


class ListingPricingScopeCount(BaseModel):
    scope: str
    count: int


class ListingPromotionSummary(BaseModel):
    type: str
    count: int


class ListingPromotionDetail(BaseModel):
    id: str
    title: str
    seller_id: str
    type: ListingType



class ListingPromotionEvent(BaseModel):
    id: str
    listing_id: str
    seller_id: str
    promoted: bool
    platform_fee_rate: str
    created_at: str


class ListingListResponse(BaseModel):
    items: list[ListingRead]
    total: int
    limit: int | None = None
    offset: int | None = None


class SellerListingSummaryRead(BaseModel):
    seller_id: str
    total: int
    product_count: int = 0
    service_count: int = 0
    hybrid_count: int = 0
    active_count: int = 0
    draft_count: int = 0
    promoted_count: int = 0
    available_today_count: int = 0
    quick_booking_count: int = 0
    local_only_count: int = 0
    price_surface_cents: int = 0


class ListingAiAssistRequest(BaseModel):
    listing_id: str | None = None
    title: str | None = None
    description: str | None = None
    type: ListingType | None = None
    category_id: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    highlights: str | None = None
    tone: str | None = None


class ListingAiAssistSuggestion(BaseModel):
    suggested_title: str
    suggested_description: str
    suggested_tags: list[str]
    suggested_category_id: str | None = None
    summary: str


class ListingAiAssistResponse(BaseModel):
    listing_id: str | None = None
    suggestion: ListingAiAssistSuggestion


class ListingBookingSuggestionRead(BaseModel):
    listing_id: str
    suggested_day_offset: int
    suggested_label: str
    summary: str
    rationale: str

class ListingPriceInsight(BaseModel):
    listing_id: str
    currency: str
    sample_size: int
    comparison_scope: str
    min_price_cents: int | None = None
    max_price_cents: int | None = None
    avg_price_cents: int | None = None
    median_price_cents: int | None = None
    suggested_price_cents: int | None = None
    summary: str
