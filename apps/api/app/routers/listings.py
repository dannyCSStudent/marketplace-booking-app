import csv
import io
from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse

from app.dependencies.auth import get_current_user
from app.dependencies.admin import require_admin_user
from app.schemas.listings import (
    ListingAiAssistRequest,
    ListingAiAssistResponse,
    ListingCreate,
    ListingImageCreate,
    ListingImageRead,
    ListingImageUploadCreate,
    ListingListResponse,
    ListingPriceInsight,
    ListingQueryParams,
    ListingRead,
    ListingUpdate,
)
from app.services.listings import (
    add_listing_image,
    create_listing,
    delete_listing_image,
    generate_listing_ai_assist,
    get_admin_listings,
    get_listing_by_id,
    get_listing_price_insight,
    get_my_listings,
    list_public_listings,
    upload_listing_image,
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


@router.get("/export")
def export_listings(
    query: str | None = Query(default=None),
    category: str | None = Query(default=None),
    type: str | None = Query(default=None),
):
    params = ListingQueryParams(query=query, category=category, type=type)
    response = list_public_listings(params)

    def iter_csv():
        header = [
            "id",
            "title",
            "type",
            "category",
            "price_cents",
            "currency",
            "status",
            "last_pricing_comparison_scope",
            "last_operating_adjustment_summary",
            "available_today",
            "is_new_listing",
        ]
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(header)
        yield buffer.getvalue()
        buffer.truncate(0)
        buffer.seek(0)
        for listing in response.items:
            writer.writerow([
                listing.id,
                listing.title,
                listing.type,
                listing.category or "",
                listing.price_cents or "",
                listing.currency,
                listing.status,
                listing.last_pricing_comparison_scope or "",
                listing.last_operating_adjustment_summary or "",
                listing.available_today,
                listing.is_new_listing,
            ])
            yield buffer.getvalue()
            buffer.truncate(0)
            buffer.seek(0)

    return StreamingResponse(iter_csv(), media_type="text/csv")

@router.get("/me", response_model=list[ListingRead])
def read_my_listings(current_user=Depends(get_current_user)) -> list[ListingRead]:
    return get_my_listings(current_user)

@router.get("/admin", response_model=list[ListingRead])
def read_admin_listings(current_user=Depends(require_admin_user)) -> list[ListingRead]:
    return get_admin_listings()

@router.post("/ai-assist", response_model=ListingAiAssistResponse)
def request_ai_listing_suggestion(
    payload: ListingAiAssistRequest,
    current_user=Depends(get_current_user),
) -> ListingAiAssistResponse:
    return generate_listing_ai_assist(current_user, payload)

@router.get("/{listing_id}/price-insights", response_model=ListingPriceInsight)
def read_listing_price_insight(listing_id: str, current_user=Depends(get_current_user)) -> ListingPriceInsight:
    return get_listing_price_insight(current_user, listing_id)

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

@router.post("/{listing_id}/images", response_model=ListingImageRead, status_code=status.HTTP_201_CREATED)
def create_listing_image(
    listing_id: str,
    payload: ListingImageCreate,
    current_user=Depends(get_current_user),
):
    return add_listing_image(current_user, listing_id, payload)


@router.post("/{listing_id}/images/upload", response_model=ListingImageRead, status_code=status.HTTP_201_CREATED)
def upload_my_listing_image(
    listing_id: str,
    payload: ListingImageUploadCreate,
    current_user=Depends(get_current_user),
) -> ListingImageRead:
    return upload_listing_image(current_user, listing_id, payload)


@router.delete("/{listing_id}/images/{image_id}", response_model=ListingImageRead)
def remove_listing_image(
    listing_id: str,
    image_id: str,
    current_user=Depends(get_current_user),
) -> ListingImageRead:
    return delete_listing_image(current_user, listing_id, image_id)
