from app.dependencies.auth import CurrentUser
from app.schemas.listings import (
    ListingCreate,
    ListingImageCreate,
    ListingListResponse,
    ListingQueryParams,
    ListingRead,
    ListingUpdate,
)

def list_public_listings(params: ListingQueryParams) -> ListingListResponse:
    items = [
        ListingRead(
            id="mock-listing-id",
            seller_id="mock-seller-id",
            category_id=None,
            title="Mock Listing",
            description="Mock listing description",
            type=params.type or "product",
            price_cents=1500,
            currency="USD",
            city="Dallas",
            state="TX",
            country="USA",
        )
    ]
    return ListingListResponse(items=items, total=len(items))

def get_my_listings(current_user: CurrentUser) -> list[ListingRead]:
    return [
        ListingRead(
            id="mock-listing-id",
            seller_id="mock-seller-id",
            category_id=None,
            title="My Mock Listing",
            description="Owned by current seller",
            type="product",
            price_cents=2000,
            currency="USD",
            city="Dallas",
            state="TX",
            country="USA",
        )
    ]

def get_listing_by_id(listing_id: str) -> ListingRead:
    return ListingRead(
        id=listing_id,
        seller_id="mock-seller-id",
        category_id=None,
        title="Mock Listing",
        description="Mock listing description",
        type="product",
        price_cents=1500,
        currency="USD",
        city="Dallas",
        state="TX",
        country="USA",
    )

def create_listing(current_user: CurrentUser, payload: ListingCreate) -> ListingRead:
    return ListingRead(
        id="mock-listing-id",
        seller_id=payload.seller_id,
        category_id=payload.category_id,
        title=payload.title,
        description=payload.description,
        type=payload.type,
        price_cents=payload.price_cents,
        currency=payload.currency,
        city=payload.city,
        state=payload.state,
        country=payload.country,
    )

def update_listing(current_user: CurrentUser, listing_id: str, payload: ListingUpdate) -> ListingRead:
    return ListingRead(
        id=listing_id,
        seller_id="mock-seller-id",
        category_id=payload.category_id,
        title=payload.title or "Updated Listing",
        description=payload.description,
        type=payload.type or "product",
        price_cents=payload.price_cents,
        currency=payload.currency or "USD",
        city=payload.city,
        state=payload.state,
        country=payload.country,
    )

def add_listing_image(current_user: CurrentUser, listing_id: str, payload: ListingImageCreate):
    return {
        "id": "mock-image-id",
        "listing_id": listing_id,
        "image_url": payload.image_url,
        "alt_text": payload.alt_text,
        "sort_order": payload.sort_order,
    }