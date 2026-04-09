from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.profiles import ProfileCreate, ProfileRead, ProfileUpdate

def get_my_profile(current_user: CurrentUser) -> ProfileRead:
    supabase = get_supabase_client()
    profile_select = (
        "id,full_name,username,phone,city,state,country,"
        "email_notifications_enabled,push_notifications_enabled,marketing_notifications_enabled,"
        "expo_push_token,admin_monetization_preferences,admin_delivery_ops_preferences"
    )
    try:
        row = supabase.select(
            "profiles",
            query={
                "select": profile_select,
                "id": f"eq.{current_user.id}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return ProfileRead(**row)

def create_profile(current_user: CurrentUser, payload: ProfileCreate) -> ProfileRead:
    supabase = get_supabase_client()
    try:
        rows = supabase.insert(
            "profiles",
            {
                "id": current_user.id,
                "full_name": payload.full_name,
                "username": payload.username,
                "phone": payload.phone,
                "city": payload.city,
                "state": payload.state,
                "country": payload.country,
                "email_notifications_enabled": payload.email_notifications_enabled,
                "push_notifications_enabled": payload.push_notifications_enabled,
                "marketing_notifications_enabled": payload.marketing_notifications_enabled,
                "expo_push_token": payload.expo_push_token,
                "admin_monetization_preferences": payload.admin_monetization_preferences,
                "admin_delivery_ops_preferences": payload.admin_delivery_ops_preferences,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return ProfileRead(**rows[0])

def update_my_profile(current_user: CurrentUser, payload: ProfileUpdate) -> ProfileRead:
    supabase = get_supabase_client()
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return get_my_profile(current_user)

    try:
        rows = supabase.update(
            "profiles",
            changes,
            query={
                "id": f"eq.{current_user.id}",
                "select": (
                    "id,full_name,username,phone,city,state,country,"
                    "email_notifications_enabled,push_notifications_enabled,"
                    "marketing_notifications_enabled,expo_push_token,"
                    "admin_monetization_preferences,admin_delivery_ops_preferences"
                ),
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    return ProfileRead(**rows[0])
