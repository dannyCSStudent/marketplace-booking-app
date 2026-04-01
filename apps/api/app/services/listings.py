import re
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.listings import (
    ListingCreate,
    ListingImageCreate,
    ListingListResponse,
    ListingQueryParams,
    ListingRead,
    ListingUpdate,
)

LISTING_SELECT = (
    "id,seller_id,category_id,title,slug,description,type,status,price_cents,currency,"
    "inventory_count,requires_booking,duration_minutes,is_local_only,city,state,country,"
    "pickup_enabled,meetup_enabled,delivery_enabled,shipping_enabled,lead_time_hours,"
    "created_at,updated_at"
)


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "listing"


def _build_listing_payload(payload: ListingCreate) -> dict[str, object]:
    body = payload.model_dump(exclude_none=True)
    body["slug"] = payload.slug or f"{_slugify(payload.title)}-{uuid4().hex[:8]}"
    return body

def list_public_listings(params: ListingQueryParams) -> ListingListResponse:
    supabase = get_supabase_client()
    query = {
        "select": LISTING_SELECT,
        "status": "eq.active",
        "order": "created_at.desc",
    }
    if params.type:
        query["type"] = f"eq.{params.type}"
    if params.category:
        query["category_id"] = f"eq.{params.category}"
    if params.query:
        query["title"] = f"ilike.*{params.query}*"

    try:
        rows = supabase.select("listings", query=query, use_service_role=True)
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    items = [ListingRead(**row) for row in rows]
    return ListingListResponse(items=items, total=len(items))

def get_my_listings(current_user: CurrentUser) -> list[ListingRead]:
    supabase = get_supabase_client()

    try:
        seller = supabase.select(
            "seller_profiles",
            query={"select": "id", "user_id": f"eq.{current_user.id}"},
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            return []
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    try:
        rows = supabase.select(
            "listings",
            query={
                "select": LISTING_SELECT,
                "seller_id": f"eq.{seller['id']}",
                "order": "created_at.desc",
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [ListingRead(**row) for row in rows]

def get_listing_by_id(listing_id: str) -> ListingRead:
    supabase = get_supabase_client()
    try:
        row = supabase.select(
            "listings",
            query={
                "select": LISTING_SELECT,
                "id": f"eq.{listing_id}",
                "status": "eq.active",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return ListingRead(**row)

def create_listing(current_user: CurrentUser, payload: ListingCreate) -> ListingRead:
    supabase = get_supabase_client()
    body = _build_listing_payload(payload)

    try:
        rows = supabase.insert(
            "listings",
            body,
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return ListingRead(**rows[0])

def update_listing(current_user: CurrentUser, listing_id: str, payload: ListingUpdate) -> ListingRead:
    supabase = get_supabase_client()
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return get_listing_by_id(listing_id)

    try:
        rows = supabase.update(
            "listings",
            changes,
            query={
                "id": f"eq.{listing_id}",
                "select": LISTING_SELECT,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    return ListingRead(**rows[0])

def add_listing_image(current_user: CurrentUser, listing_id: str, payload: ListingImageCreate):
    supabase = get_supabase_client()
    try:
        rows = supabase.insert(
            "listing_images",
            {
                "listing_id": listing_id,
                "image_url": payload.image_url,
                "alt_text": payload.alt_text,
                "sort_order": payload.sort_order,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return rows[0]
