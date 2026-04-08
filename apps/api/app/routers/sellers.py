from fastapi import APIRouter, Depends, status

from app.dependencies.auth import get_current_user
from app.schemas.reviews import ReviewRead
from app.schemas.sellers import SellerCreate, SellerRead, SellerUpdate
from app.schemas.subscriptions import SellerSubscriptionRead
from app.services.sellers import (
    create_seller,
    get_my_seller,
    get_seller_by_slug,
    get_seller_reviews_by_slug,
    update_my_seller,
)
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


@router.get("/me/subscription", response_model=SellerSubscriptionRead)
def read_my_seller_subscription(current_user=Depends(get_current_user)) -> SellerSubscriptionRead:
    return get_my_seller_subscription(current_user)


@router.get("/{slug}/subscription", response_model=SellerSubscriptionRead)
def read_seller_subscription_by_slug(slug: str) -> SellerSubscriptionRead:
    return get_seller_subscription_by_slug(slug)

@router.get("/{slug}", response_model=SellerRead)
def read_seller_by_slug(slug: str) -> SellerRead:
    return get_seller_by_slug(slug)


@router.get("/{slug}/reviews", response_model=list[ReviewRead])
def read_seller_reviews_by_slug(slug: str) -> list[ReviewRead]:
    return get_seller_reviews_by_slug(slug)
