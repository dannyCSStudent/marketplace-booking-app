from fastapi import APIRouter, Depends, status

from app.dependencies.auth import get_current_user
from app.schemas.sellers import SellerCreate, SellerRead, SellerUpdate
from app.services.sellers import create_seller, get_my_seller, get_seller_by_slug, update_my_seller

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

@router.get("/{slug}", response_model=SellerRead)
def read_seller_by_slug(slug: str) -> SellerRead:
    return get_seller_by_slug(slug)