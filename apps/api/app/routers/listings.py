from fastapi import APIRouter, Depends, Query, status

from app.dependencies.auth import get_current_user
from app.schemas.listings import (
    ListingCreate,
    ListingImageCreate,
    ListingListResponse,
    ListingQueryParams,
    ListingRead,
    ListingUpdate,
)
from app.services.listings import (
    add_listing_image,
    create_listing,
    get_listing_by_id,
    get_my_listings,
    list_public_listings,
    update_listing,
)

router = APIRouter()

@router.get("", response_model=ListingListResponse)
def list_listings(
    query: str | None = Query(default=None),
    category: str | None = Query(default=None),
    type: str | None = Query(default=None),
) -> ListingListResponse:
    params = ListingQueryParams(query=query, category=category, type=type)
    return list_public_listings(params)

@router.get("/me", response_model=list[ListingRead])
def read_my_listings(current_user=Depends(get_current_user)) -> list[ListingRead]:
    return get_my_listings(current_user)

@router.get("/{listing_id}", response_model=ListingRead)
def read_listing(listing_id: str) -> ListingRead:
    return get_listing_by_id(listing_id)

@router.post("", response_model=ListingRead, status_code=status.HTTP_201_CREATED)
def create_my_listing(
    payload: ListingCreate,
    current_user=Depends(get_current_user),
) -> ListingRead:
    return create_listing(current_user, payload)

@router.patch("/{listing_id}", response_model=ListingRead)
def patch_listing(
    listing_id: str,
    payload: ListingUpdate,
    current_user=Depends(get_current_user),
) -> ListingRead:
    return update_listing(current_user, listing_id, payload)

@router.post("/{listing_id}/images", status_code=status.HTTP_201_CREATED)
def create_listing_image(
    listing_id: str,
    payload: ListingImageCreate,
    current_user=Depends(get_current_user),
):
    return add_listing_image(current_user, listing_id, payload)