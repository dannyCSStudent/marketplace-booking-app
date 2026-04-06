from pydantic import BaseModel

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
