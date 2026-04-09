from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.reviews import ReviewRead
from app.schemas.sellers import SellerCreate, SellerLookupRead, SellerRead, SellerUpdate

SELLER_SELECT = (
    "id,user_id,display_name,slug,bio,is_verified,accepts_custom_orders,"
    "average_rating,review_count,city,state,country"
)

def get_my_seller(current_user: CurrentUser) -> SellerRead:
    supabase = get_supabase_client()
    try:
        row = supabase.select(
            "seller_profiles",
            query={
                "select": SELLER_SELECT,
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
                "select": SELLER_SELECT,
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
                "select": SELLER_SELECT,
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


def get_seller_reviews_by_slug(slug: str, limit: int = 5) -> list[ReviewRead]:
    supabase = get_supabase_client()
    seller = get_seller_by_slug(slug)

    try:
        rows = supabase.select(
            "reviews",
            query={
                "select": "id,rating,comment,seller_response,seller_responded_at,is_hidden,hidden_at,created_at",
                "seller_id": f"eq.{seller.id}",
                "is_hidden": "eq.false",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [ReviewRead(**row) for row in rows]


def search_sellers(query_text: str | None = None, limit: int = 8) -> list[SellerLookupRead]:
    supabase = get_supabase_client()
    query = {
        "select": "id,display_name,slug,is_verified,city,state,country",
        "order": "display_name.asc",
        "limit": str(limit),
    }
    if query_text:
        escaped_query = query_text.strip().replace(",", r"\,")
        if escaped_query:
            query["or"] = f"display_name.ilike.*{escaped_query}*,slug.ilike.*{escaped_query}*"

    try:
        rows = supabase.select(
            "seller_profiles",
            query=query,
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [SellerLookupRead(**row) for row in rows]
