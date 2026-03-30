from fastapi import APIRouter, Depends, status

from app.dependencies.auth import get_current_user
from app.schemas.profiles import ProfileCreate, ProfileRead, ProfileUpdate
from app.services.profiles import create_profile, get_my_profile, update_my_profile

router = APIRouter()

@router.get("/me", response_model=ProfileRead)
def read_my_profile(current_user=Depends(get_current_user)) -> ProfileRead:
    return get_my_profile(current_user)

@router.post("/me", response_model=ProfileRead, status_code=status.HTTP_201_CREATED)
def create_my_profile(
    payload: ProfileCreate,
    current_user=Depends(get_current_user),
) -> ProfileRead:
    return create_profile(current_user, payload)

@router.patch("/me", response_model=ProfileRead)
def patch_my_profile(
    payload: ProfileUpdate,
    current_user=Depends(get_current_user),
) -> ProfileRead:
    return update_my_profile(current_user, payload)