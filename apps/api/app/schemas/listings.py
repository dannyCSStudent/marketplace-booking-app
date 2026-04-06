from pydantic import BaseModel

class ListingQueryParams(BaseModel):
    query: str | None = None
    category: str | None = None
    type: str | None = None

class ListingCreate(BaseModel):
    seller_id: str
    category_id: str | None = None
    title: str
    slug: str | None = None
    description: str | None = None
    type: str
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

class ListingUpdate(BaseModel):
    category_id: str | None = None
    title: str | None = None
    slug: str | None = None
    description: str | None = None
    type: str | None = None
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
    title: str
    slug: str
    description: str | None = None
    type: str
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

class ListingListResponse(BaseModel):
    items: list[ListingRead]
    total: int
