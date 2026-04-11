from fastapi import APIRouter, Depends, Query, status

from app.dependencies.auth import get_current_user
from app.schemas.listings import (
    ListingListResponse,
    ListingQueryParams,
    ListingType,
    SellerListingSummaryRead,
)
from app.schemas.reviews import ReviewRead
from app.schemas.sellers import SellerCreate, SellerProfileCompletionRead, SellerRead, SellerUpdate
from app.schemas.subscriptions import SellerSubscriptionRead
from app.services.sellers import (
    create_seller,
    get_seller_by_id,
    get_my_seller_profile_completion,
    get_my_seller,
    get_seller_by_slug,
    get_seller_reviews_by_slug,
    update_my_seller,
)
from app.services.listings import get_seller_listing_summary_by_slug, list_public_listings_by_seller_slug
from app.services.subscriptions import get_my_seller_subscription, get_seller_subscription_by_slug

router = APIRouter()

@router.get("/me", response_model=SellerRead)
def read_my_seller(current_user=Depends(get_current_user)) -> SellerRead:
    return get_my_seller(current_user)

@router.post("", response_model=SellerRead, status_code=status.HTTP_201_CREATED)
def create_my_seller(
    payload: SellerCreate,
    current_user=Depends(get_current_user),
) -> SellerRead:
    return create_seller(current_user, payload)

@router.patch("/me", response_model=SellerRead)
def patch_my_seller(
    payload: SellerUpdate,
    current_user=Depends(get_current_user),
) -> SellerRead:
    return update_my_seller(current_user, payload)


@router.get("/me/completion", response_model=SellerProfileCompletionRead)
def read_my_seller_profile_completion(
    current_user=Depends(get_current_user),
) -> SellerProfileCompletionRead:
    return get_my_seller_profile_completion(current_user)


@router.get("/me/subscription", response_model=SellerSubscriptionRead)
def read_my_seller_subscription(current_user=Depends(get_current_user)) -> SellerSubscriptionRead:
    return get_my_seller_subscription(current_user)


@router.get("/{slug}/subscription", response_model=SellerSubscriptionRead)
def read_seller_subscription_by_slug(slug: str) -> SellerSubscriptionRead:
    return get_seller_subscription_by_slug(slug)


@router.get("/{slug}/listings/summary", response_model=SellerListingSummaryRead)
def read_seller_listing_summary_by_slug(slug: str) -> SellerListingSummaryRead:
    return get_seller_listing_summary_by_slug(slug)


@router.get("/by-id/{seller_id}", response_model=SellerRead)
def read_seller_by_id(seller_id: str) -> SellerRead:
    return get_seller_by_id(seller_id)

@router.get("/{slug}", response_model=SellerRead)
def read_seller_by_slug(slug: str) -> SellerRead:
    return get_seller_by_slug(slug)


@router.get("/{slug}/listings", response_model=ListingListResponse)
def read_seller_listings_by_slug(
    slug: str,
    query: str | None = Query(default=None),
    category: str | None = Query(default=None),
    type: ListingType | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1),
    offset: int | None = Query(default=None, ge=0),
) -> ListingListResponse:
    params = ListingQueryParams(
        query=query,
        category=category,
        type=type,
        limit=limit,
        offset=offset,
    )
    return list_public_listings_by_seller_slug(slug, params)


@router.get("/{slug}/reviews", response_model=list[ReviewRead])
def read_seller_reviews_by_slug(slug: str) -> list[ReviewRead]:
    return get_seller_reviews_by_slug(slug)
