from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.sellers import SellerCreate, SellerRead, SellerUpdate

def get_my_seller(current_user: CurrentUser) -> SellerRead:
    supabase = get_supabase_client()
    try:
        row = supabase.select(
            "seller_profiles",
            query={
                "select": "id,user_id,display_name,slug,bio,city,state,country,accepts_custom_orders",
                "user_id": f"eq.{current_user.id}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller profile not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return SellerRead(**row)

def create_seller(current_user: CurrentUser, payload: SellerCreate) -> SellerRead:
    supabase = get_supabase_client()
    try:
        rows = supabase.insert(
            "seller_profiles",
            {
                "user_id": current_user.id,
                "display_name": payload.display_name,
                "slug": payload.slug,
                "bio": payload.bio,
                "city": payload.city,
                "state": payload.state,
                "country": payload.country,
                "accepts_custom_orders": payload.accepts_custom_orders,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return SellerRead(**rows[0])

def update_my_seller(current_user: CurrentUser, payload: SellerUpdate) -> SellerRead:
    supabase = get_supabase_client()
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return get_my_seller(current_user)

    try:
        rows = supabase.update(
            "seller_profiles",
            changes,
            query={
                "user_id": f"eq.{current_user.id}",
                "select": "id,user_id,display_name,slug,bio,city,state,country,accepts_custom_orders",
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller profile not found")

    return SellerRead(**rows[0])

def get_seller_by_slug(slug: str) -> SellerRead:
    supabase = get_supabase_client()
    try:
        row = supabase.select(
            "seller_profiles",
            query={
                "select": "id,user_id,display_name,slug,bio,city,state,country,accepts_custom_orders",
                "slug": f"eq.{slug}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller profile not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return SellerRead(**row)
