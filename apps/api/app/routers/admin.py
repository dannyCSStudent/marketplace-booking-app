from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.dependencies.admin import require_admin_user
from app.schemas.admin import AdminUserRead
from app.schemas.monetization import MonetizationWatchlistAlertRead, MonetizationWatchlistEventRead, MonetizationWatchlistSummaryRead
from app.schemas.listings import (
    ListingPricingScopeCount,
    ListingPromotionDetail,
    ListingPromotionSummary,
    ListingPromotionEvent,
    ListingRead,
)
from app.schemas.platform_fees import DeliveryFeeHistoryPoint, PlatformFeeHistoryPoint
from app.schemas.sellers import SellerLookupRead, SellerProfileCompletionRead, SellerTrustInterventionRead
from app.schemas.subscriptions import (
    SellerSubscriptionAssign,
    SellerSubscriptionEventRead,
    SellerSubscriptionRead,
    SubscriptionTierCreate,
    SubscriptionTierRead,
)
from app.services.admin import list_admin_users
from app.services.listings import (
    list_pricing_scope_counts,
    list_pricing_scope_listings,
    list_promoted_listings,
    list_promoted_summary,
    list_promotion_events,
    set_listing_promotion,
)
from app.services.delivery_fees import list_delivery_fee_history
from app.services.monetization_watchlist import (
    acknowledge_monetization_watchlist_alert,
    clear_monetization_watchlist_alert_acknowledgement,
    list_monetization_watchlist_alerts,
    list_monetization_watchlist_events,
    list_monetization_watchlist_summaries,
)
from app.services.platform_fees import list_platform_fee_history
from app.services.sellers import list_seller_profile_completions, list_seller_trust_interventions, search_sellers
from app.services.subscriptions import (
    assign_seller_subscription,
    create_subscription_tier,
    list_seller_subscriptions,
    list_subscription_events,
    list_subscription_tiers,
)

router = APIRouter()


@router.get("/users", response_model=list[AdminUserRead])
def read_admin_users(current_user=Depends(require_admin_user)) -> list[AdminUserRead]:
    return list_admin_users()


@router.get("/sellers", response_model=list[SellerLookupRead])
def read_admin_sellers(
    query: str | None = Query(None, min_length=1),
    limit: int = Query(8, ge=1, le=25),
    current_user=Depends(require_admin_user),
) -> list[SellerLookupRead]:
    return search_sellers(query_text=query, limit=limit)


@router.get("/seller-trust/interventions", response_model=list[SellerTrustInterventionRead])
def read_seller_trust_interventions(
    limit: int = Query(20, ge=1, le=50),
    current_user=Depends(require_admin_user),
) -> list[SellerTrustInterventionRead]:
    return list_seller_trust_interventions(limit=limit)


@router.get("/seller-profile-completion", response_model=list[SellerProfileCompletionRead])
def read_seller_profile_completions(
    limit: int = Query(24, ge=1, le=100),
    state: str | None = Query(None),
    current_user=Depends(require_admin_user),
) -> list[SellerProfileCompletionRead]:
    return list_seller_profile_completions(limit=limit, state=state)


@router.get(
    "/listings/pricing-scope-summary",
    response_model=list[ListingPricingScopeCount],
)
def read_pricing_scope_counts(current_user=Depends(require_admin_user)):
    return list_pricing_scope_counts()


@router.get(
    "/listings/pricing-scope-items",
    response_model=list[ListingRead],
)
def read_pricing_scope_listings(
    scope: str = Query(..., min_length=1),
    current_user=Depends(require_admin_user),
) -> list[ListingRead]:
    return list_pricing_scope_listings(scope)


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


@router.get(
    "/delivery-fees/history",
    response_model=list[DeliveryFeeHistoryPoint],
)
def read_delivery_fee_history(
    days: int = Query(14, ge=1, le=60),
    current_user=Depends(require_admin_user),
) -> list[DeliveryFeeHistoryPoint]:
    rows = list_delivery_fee_history(days=days)
    return [DeliveryFeeHistoryPoint(**row) for row in rows]


@router.get(
    "/subscription-tiers",
    response_model=list[SubscriptionTierRead],
)
def read_subscription_tiers(current_user=Depends(require_admin_user)) -> list[SubscriptionTierRead]:
    return list_subscription_tiers()


@router.post(
    "/subscription-tiers",
    response_model=SubscriptionTierRead,
)
def create_admin_subscription_tier(
    payload: SubscriptionTierCreate,
    current_user=Depends(require_admin_user),
) -> SubscriptionTierRead:
    return create_subscription_tier(payload)


@router.get(
    "/seller-subscriptions",
    response_model=list[SellerSubscriptionRead],
)
def read_seller_subscriptions(
    limit: int = Query(100, ge=1, le=200),
    current_user=Depends(require_admin_user),
) -> list[SellerSubscriptionRead]:
    return list_seller_subscriptions(limit=limit)


@router.get(
    "/seller-subscription-events",
    response_model=list[SellerSubscriptionEventRead],
)
def read_seller_subscription_events(
    limit: int = Query(100, ge=1, le=200),
    current_user=Depends(require_admin_user),
) -> list[SellerSubscriptionEventRead]:
    return list_subscription_events(limit=limit)


@router.post(
    "/seller-subscriptions",
    response_model=SellerSubscriptionRead,
)
def assign_admin_seller_subscription(
    payload: SellerSubscriptionAssign,
    current_user=Depends(require_admin_user),
) -> SellerSubscriptionRead:
    return assign_seller_subscription(payload, actor_user_id=current_user.id)


@router.get(
    "/monetization/watchlist/alerts",
    response_model=list[MonetizationWatchlistAlertRead],
)
def read_monetization_watchlist_alerts(
    since_at: datetime | None = Query(None),
    current_user=Depends(require_admin_user),
) -> list[MonetizationWatchlistAlertRead]:
    return list_monetization_watchlist_alerts(since_at=since_at)


@router.get(
    "/monetization/watchlist/summaries",
    response_model=list[MonetizationWatchlistSummaryRead],
)
def read_monetization_watchlist_summaries(
    since_at: datetime | None = Query(None),
    limit: int = Query(12, ge=1, le=50),
    state: str | None = Query(None),
    current_user=Depends(require_admin_user),
) -> list[MonetizationWatchlistSummaryRead]:
    return list_monetization_watchlist_summaries(since_at=since_at, limit=limit, state=state)


@router.get(
    "/monetization/watchlist/events",
    response_model=list[MonetizationWatchlistEventRead],
)
def read_monetization_watchlist_events(
    limit: int = Query(20, ge=1, le=100),
    current_user=Depends(require_admin_user),
) -> list[MonetizationWatchlistEventRead]:
    return list_monetization_watchlist_events(limit=limit)


@router.post(
    "/monetization/watchlist/{alert_id}/acknowledge",
    response_model=list[MonetizationWatchlistEventRead],
)
def acknowledge_monetization_watchlist_alert_route(
    alert_id: str,
    current_user=Depends(require_admin_user),
) -> list[dict[str, object]]:
    return acknowledge_monetization_watchlist_alert(alert_id, actor_user_id=current_user.id)


@router.delete(
    "/monetization/watchlist/{alert_id}/acknowledge",
    response_model=list[MonetizationWatchlistEventRead],
)
def clear_monetization_watchlist_alert_acknowledgement_route(
    alert_id: str,
    current_user=Depends(require_admin_user),
) -> list[dict[str, object]]:
    return clear_monetization_watchlist_alert_acknowledgement(alert_id, actor_user_id=current_user.id)
