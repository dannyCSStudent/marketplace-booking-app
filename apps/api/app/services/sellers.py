from app.dependencies.auth import CurrentUser
from app.schemas.sellers import SellerCreate, SellerRead, SellerUpdate

def get_my_seller(current_user: CurrentUser) -> SellerRead:
    return SellerRead(
        id="mock-seller-id",
        user_id=current_user.id,
        display_name="Mock Seller",
        slug="mock-seller",
        bio=None,
        city=None,
        state=None,
        country=None,
        accepts_custom_orders=True,
    )

def create_seller(current_user: CurrentUser, payload: SellerCreate) -> SellerRead:
    return SellerRead(
        id="mock-seller-id",
        user_id=current_user.id,
        display_name=payload.display_name,
        slug=payload.slug,
        bio=payload.bio,
        city=payload.city,
        state=payload.state,
        country=payload.country,
        accepts_custom_orders=payload.accepts_custom_orders,
    )

def update_my_seller(current_user: CurrentUser, payload: SellerUpdate) -> SellerRead:
    return SellerRead(
        id="mock-seller-id",
        user_id=current_user.id,
        display_name=payload.display_name or "Mock Seller",
        slug=payload.slug or "mock-seller",
        bio=payload.bio,
        city=payload.city,
        state=payload.state,
        country=payload.country,
        accepts_custom_orders=payload.accepts_custom_orders if payload.accepts_custom_orders is not None else True,
    )

def get_seller_by_slug(slug: str) -> SellerRead:
    return SellerRead(
        id="mock-seller-id",
        user_id="mock-user-id",
        display_name="Mock Seller",
        slug=slug,
        bio=None,
        city=None,
        state=None,
        country=None,
        accepts_custom_orders=True,
    )