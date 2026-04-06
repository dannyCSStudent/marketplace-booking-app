from app.core.config import get_settings
from app.dependencies.supabase import get_supabase_client
from app.schemas.admin import AdminUserRead


def list_admin_users() -> list[AdminUserRead]:
    settings = get_settings()
    allowed_ids = set(settings.admin_user_ids)
    if not allowed_ids:
        return []

    supabase = get_supabase_client()
    auth_users = supabase.list_auth_users()
    auth_users_by_id = {user.get("id"): user for user in auth_users if user.get("id")}
    profile_rows = supabase.select(
        "profiles",
        query={
            "select": "id,full_name,username",
            "id": f"in.({','.join(settings.admin_user_ids)})",
        },
        use_service_role=True,
    )
    profiles_by_id = {profile.get("id"): profile for profile in profile_rows if profile.get("id")}

    admins: list[AdminUserRead] = []
    for user_id in settings.admin_user_ids:
        auth_user = auth_users_by_id.get(user_id, {})
        profile = profiles_by_id.get(user_id, {})
        admins.append(
            AdminUserRead(
                id=user_id,
                full_name=profile.get("full_name"),
                username=profile.get("username"),
                email=auth_user.get("email"),
                role=(settings.admin_user_roles or {}).get(user_id),
            )
        )

    admins.sort(
        key=lambda admin: (
            (admin.full_name or admin.username or admin.email or "").lower(),
            admin.id,
        )
    )
    return admins
