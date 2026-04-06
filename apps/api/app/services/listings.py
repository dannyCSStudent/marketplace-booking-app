import base64
import re
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.listings import (
    ListingCreate,
    ListingImageCreate,
    ListingImageRead,
    ListingImageUploadCreate,
    ListingListResponse,
    ListingQueryParams,
    ListingRead,
    ListingUpdate,
)

LISTING_IMAGE_SELECT = "id,listing_id,image_url,alt_text,sort_order,created_at"
LISTING_SELECT = (
    "id,seller_id,category_id,title,slug,description,type,status,price_cents,currency,"
    "inventory_count,requires_booking,duration_minutes,is_local_only,city,state,country,"
    "pickup_enabled,meetup_enabled,delivery_enabled,shipping_enabled,lead_time_hours,"
    f"created_at,updated_at,images:listing_images({LISTING_IMAGE_SELECT})"
)


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "listing"


def _safe_file_extension(filename: str, content_type: str) -> str:
    if "." in filename:
        suffix = filename.rsplit(".", 1)[-1].lower()
        if suffix in {"jpg", "jpeg", "png", "webp"}:
            return "jpg" if suffix == "jpeg" else suffix

    if content_type == "image/png":
        return "png"
    if content_type == "image/webp":
        return "webp"
    return "jpg"


def _build_listing_payload(payload: ListingCreate) -> dict[str, object]:
    body = payload.model_dump(exclude_none=True)
    body["slug"] = payload.slug or f"{_slugify(payload.title)}-{uuid4().hex[:8]}"
    return body


def _to_listing_read(row: dict[str, object]) -> ListingRead:
    images = sorted(
        [ListingImageRead(**image) for image in (row.get("images") or [])],
        key=lambda image: (image.sort_order, image.created_at),
    )
    return ListingRead(**{**row, "images": images})

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

    items = [_to_listing_read(row) for row in rows]
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

    return [_to_listing_read(row) for row in rows]

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

    return _to_listing_read(row)

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

    return _to_listing_read(rows[0])

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

    return _to_listing_read(rows[0])

def add_listing_image(
    current_user: CurrentUser,
    listing_id: str,
    payload: ListingImageCreate,
) -> ListingImageRead:
    supabase = get_supabase_client()
    sort_order = payload.sort_order
    if sort_order is None:
        try:
            existing_images = supabase.select(
                "listing_images",
                query={
                    "select": "sort_order",
                    "listing_id": f"eq.{listing_id}",
                    "order": "sort_order.desc",
                },
                access_token=current_user.access_token,
            )
        except SupabaseError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        sort_order = (existing_images[0]["sort_order"] + 1) if existing_images else 0

    try:
        rows = supabase.insert(
            "listing_images",
            {
                "listing_id": listing_id,
                "image_url": payload.image_url,
                "alt_text": payload.alt_text,
                "sort_order": sort_order,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return ListingImageRead(**rows[0])


def upload_listing_image(
    current_user: CurrentUser,
    listing_id: str,
    payload: ListingImageUploadCreate,
) -> ListingImageRead:
    supabase = get_supabase_client()
    try:
        image_bytes = base64.b64decode(payload.base64_data, validate=True)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Listing image upload payload is not valid base64",
        ) from exc

    if not payload.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only image uploads are supported",
        )

    extension = _safe_file_extension(payload.filename, payload.content_type)
    object_path = f"{current_user.id}/{listing_id}/{uuid4().hex}.{extension}"

    try:
        supabase.upload_storage_object(
            bucket=supabase.settings.listing_media_bucket,
            path=object_path,
            payload=image_bytes,
            content_type=payload.content_type,
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return add_listing_image(
        current_user,
        listing_id,
        ListingImageCreate(
            image_url=supabase.public_storage_url(
                supabase.settings.listing_media_bucket,
                object_path,
            ),
            alt_text=payload.alt_text,
        ),
    )


def delete_listing_image(
    current_user: CurrentUser,
    listing_id: str,
    image_id: str,
) -> ListingImageRead:
    supabase = get_supabase_client()
    try:
        rows = supabase.delete(
            "listing_images",
            query={
                "id": f"eq.{image_id}",
                "listing_id": f"eq.{listing_id}",
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing image not found")

    return ListingImageRead(**rows[0])
