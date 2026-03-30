from app.dependencies.auth import CurrentUser
from app.schemas.profiles import ProfileCreate, ProfileRead, ProfileUpdate

def get_my_profile(current_user: CurrentUser) -> ProfileRead:
    return ProfileRead(
        id=current_user.id,
        full_name="Mock User",
        username="mockuser",
        phone=None,
        city=None,
        state=None,
        country=None,
    )

def create_profile(current_user: CurrentUser, payload: ProfileCreate) -> ProfileRead:
    return ProfileRead(
        id=current_user.id,
        full_name=payload.full_name,
        username=payload.username,
        phone=payload.phone,
        city=payload.city,
        state=payload.state,
        country=payload.country,
    )

def update_my_profile(current_user: CurrentUser, payload: ProfileUpdate) -> ProfileRead:
    return ProfileRead(
        id=current_user.id,
        full_name=payload.full_name,
        username=payload.username,
        phone=payload.phone,
        city=payload.city,
        state=payload.state,
        country=payload.country,
    )