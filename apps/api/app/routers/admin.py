from fastapi import APIRouter, Depends, Query

from app.dependencies.admin import require_admin_user
from app.schemas.admin import AdminUserRead
from app.schemas.listings import (
    ListingPricingScopeCount,
    ListingPromotionDetail,
    ListingPromotionSummary,
    ListingPromotionEvent,
    ListingRead,
)
from app.schemas.platform_fees import PlatformFeeHistoryPoint
from app.services.admin import list_admin_users
from app.services.listings import (
    list_pricing_scope_counts,
    list_promoted_listings,
    list_promoted_summary,
    list_promotion_events,
    set_listing_promotion,
)
from app.services.platform_fees import list_platform_fee_history

router = APIRouter()


@router.get("/users", response_model=list[AdminUserRead])
def read_admin_users(current_user=Depends(require_admin_user)) -> list[AdminUserRead]:
    return list_admin_users()


@router.get(
    "/listings/pricing-scope-summary",
    response_model=list[ListingPricingScopeCount],
)
def read_pricing_scope_counts(current_user=Depends(require_admin_user)):
    return list_pricing_scope_counts()


@router.get("/listings/promoted", response_model=list[ListingPromotionDetail])
def read_promoted_listings(current_user=Depends(require_admin_user)):
    rows = list_promoted_listings()
    return [ListingPromotionDetail(**row) for row in rows]


@router.get(
    "/listings/promotions/summary",
    response_model=list[ListingPromotionSummary],
)
def read_promoted_summary(current_user=Depends(require_admin_user)):
    rows = list_promoted_summary()
    return [ListingPromotionSummary(**{"type": row.get("type", "unknown"), "count": int(row.get("count", 0))}) for row in rows]


@router.get(
    "/listings/promotions/events",
    response_model=list[ListingPromotionEvent],
)
def read_promotion_events(
    limit: int = Query(20, ge=1, le=100),
    current_user=Depends(require_admin_user),
) -> list[ListingPromotionEvent]:
    rows = list_promotion_events(limit=limit)
    return [ListingPromotionEvent(**row) for row in rows]


@router.patch("/listings/{listing_id}/promotion", response_model=ListingRead)
def update_listing_promotion(
    listing_id: str,
    promoted: bool,
    current_user=Depends(require_admin_user),
) -> ListingRead:
    return set_listing_promotion(listing_id, promoted)


@router.get(
    "/platform-fees/history",
    response_model=list[PlatformFeeHistoryPoint],
)
def read_platform_fee_history(
    days: int = Query(14, ge=1, le=60),
    current_user=Depends(require_admin_user),
) -> list[PlatformFeeHistoryPoint]:
    rows = list_platform_fee_history(days=days)
    return [PlatformFeeHistoryPoint(**row) for row in rows]
