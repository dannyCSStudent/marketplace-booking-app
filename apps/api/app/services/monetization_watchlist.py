from datetime import datetime, timezone, timedelta

from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client
from app.schemas.monetization import (
    MonetizationWatchlistAlertRead,
    MonetizationWatchlistEventRead,
    MonetizationWatchlistSummaryRead,
)
from app.schemas.subscriptions import SellerSubscriptionEventRead, SubscriptionTierRead
from app.services.listings import list_promotion_events, list_promoted_summary
from app.services.subscriptions import list_subscription_events, list_subscription_tiers

MONETIZATION_WATCHLIST_EVENT_SELECT = (
    "id,alert_id,alert_signature,actor_user_id,action,alert_title,alert_severity,created_at"
)


def _parse_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _build_subscription_plan_diff(
    current_tier: SubscriptionTierRead | None,
    next_tier: SubscriptionTierRead | None,
) -> tuple[int, list[str]]:
    if next_tier is None:
        return 0, []

    current_monthly_price_cents = current_tier.monthly_price_cents if current_tier else 0
    next_monthly_price_cents = next_tier.monthly_price_cents
    price_delta_cents = next_monthly_price_cents - current_monthly_price_cents
    lost_perks: list[str] = []
    perk_definitions = [
        ("Analytics", bool(current_tier.analytics_enabled) if current_tier else False, bool(next_tier.analytics_enabled)),
        (
            "Priority visibility",
            bool(current_tier.priority_visibility) if current_tier else False,
            bool(next_tier.priority_visibility),
        ),
        (
            "Premium storefront",
            bool(current_tier.premium_storefront) if current_tier else False,
            bool(next_tier.premium_storefront),
        ),
    ]

    for label, current, next_value in perk_definitions:
        if current and not next_value:
            lost_perks.append(label)

    return price_delta_cents, lost_perks


def _is_destructive_subscription_event(
    event: SellerSubscriptionEventRead,
    tiers_by_id: dict[str, SubscriptionTierRead],
) -> bool:
    from_tier = tiers_by_id.get(event.from_tier_id or "")
    to_tier = tiers_by_id.get(event.to_tier_id or "")
    price_delta_cents, lost_perks = _build_subscription_plan_diff(from_tier, to_tier)
    return event.action == "downgrade" or price_delta_cents < 0 or bool(lost_perks)


def _make_alert(
    *,
    id: str,
    signature: str,
    title: str,
    detail: str,
    severity: str,
    tone: str,
    action_label: str,
    replay_key: str,
) -> MonetizationWatchlistAlertRead:
    return MonetizationWatchlistAlertRead(
        id=id,
        signature=signature,
        title=title,
        detail=detail,
        severity=severity,  # type: ignore[arg-type]
        tone=tone,  # type: ignore[arg-type]
        action_label=action_label,
        replay_key=replay_key,  # type: ignore[arg-type]
        created_at=datetime.now(timezone.utc),
    )


def list_monetization_watchlist_alerts(*, since_at: datetime | None = None) -> list[MonetizationWatchlistAlertRead]:
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)
    prior_seven_days_ago = seven_days_ago - timedelta(days=7)

    subscription_events = list_subscription_events(limit=200)
    tiers_by_id = {tier.id or "": tier for tier in list_subscription_tiers() if tier.id}
    promotion_events = list_promotion_events(limit=200)
    promoted_summary = list_promoted_summary()
    total_promoted = sum(int(row.get("count", 0) or 0) for row in promoted_summary)

    recent_subscription_events = [
        event
        for event in subscription_events
        if (event.created_at or datetime.min.replace(tzinfo=timezone.utc)) >= seven_days_ago
    ]
    prior_subscription_events = [
        event
        for event in subscription_events
        if prior_seven_days_ago
        <= (event.created_at or datetime.min.replace(tzinfo=timezone.utc))
        < seven_days_ago
    ]
    destructive_recent = [
        event for event in recent_subscription_events if _is_destructive_subscription_event(event, tiers_by_id)
    ]
    destructive_prior = [
        event for event in prior_subscription_events if _is_destructive_subscription_event(event, tiers_by_id)
    ]
    downgrades_recent = [event for event in recent_subscription_events if event.action == "downgrade"]
    downgrades_since_baseline = [
        event for event in subscription_events if since_at and (event.created_at or now) >= since_at and event.action == "downgrade"
    ]
    destructive_since_baseline = [
        event
        for event in subscription_events
        if since_at and (event.created_at or now) >= since_at and _is_destructive_subscription_event(event, tiers_by_id)
    ]

    recent_promotion_events = [
        row
        for row in promotion_events
        if (created_at := _parse_datetime(row.get("created_at"))) and created_at >= seven_days_ago
    ]
    promotion_adds = sum(1 for row in recent_promotion_events if bool(row.get("promoted")))
    promotion_removals = sum(1 for row in recent_promotion_events if not bool(row.get("promoted")))
    promotion_adds_since_baseline = sum(
        1
        for row in promotion_events
        if since_at and (created_at := _parse_datetime(row.get("created_at"))) and created_at >= since_at and bool(row.get("promoted"))
    )
    promotion_removals_since_baseline = sum(
        1
        for row in promotion_events
        if since_at and (created_at := _parse_datetime(row.get("created_at"))) and created_at >= since_at and not bool(row.get("promoted"))
    )

    alerts: list[MonetizationWatchlistAlertRead] = []

    if (
        (since_at and destructive_since_baseline)
        or (len(destructive_recent) >= 3 and len(destructive_recent) > len(destructive_prior))
    ):
        signature = (
            f"since-visit:{len(destructive_since_baseline)}"
            if since_at
            else f"rolling:{len(destructive_recent)}:{len(destructive_prior)}"
        )
        alerts.append(
            _make_alert(
                id="subscription-destructive-spike",
                signature=signature,
                title=(
                    "New destructive subscription changes landed since your last visit"
                    if since_at
                    else "Destructive subscription changes are rising"
                ),
                detail=(
                    f"{len(destructive_since_baseline)} destructive subscription changes were recorded since you last viewed the monetization dashboard."
                    if since_at
                    else f"{len(destructive_recent)} destructive subscription changes landed in the last 7 days, up from {len(destructive_prior)} in the prior week."
                ),
                severity="high",
                tone="rose",
                action_label="Review subscription history",
                replay_key="subscription_destructive",
            )
        )

    if (since_at and downgrades_since_baseline) or len(downgrades_recent) >= 2:
        signature = (
            f"since-visit:{len(downgrades_since_baseline)}"
            if since_at
            else f"rolling:{len(downgrades_recent)}"
        )
        alerts.append(
            _make_alert(
                id="subscription-downgrade-pressure",
                signature=signature,
                title="Downgrade pressure needs review",
                detail=(
                    f"{len(downgrades_since_baseline)} seller downgrades have happened since your last visit."
                    if since_at
                    else f"{len(downgrades_recent)} seller downgrades were recorded in the last 7 days. Check whether pricing or perk loss is driving the change."
                ),
                severity="medium",
                tone="amber",
                action_label="Open downgrade slice",
                replay_key="subscription_downgrade",
            )
        )

    if (
        (since_at and promotion_removals_since_baseline > promotion_adds_since_baseline)
        or (promotion_removals > promotion_adds and promotion_removals >= 3)
    ):
        signature = (
            f"since-visit:{promotion_removals_since_baseline}:{promotion_adds_since_baseline}"
            if since_at
            else f"rolling:{promotion_removals}:{promotion_adds}"
        )
        alerts.append(
            _make_alert(
                id="promotion-removal-pressure",
                signature=signature,
                title=(
                    "Promotion removals outpaced adds since your last visit"
                    if since_at
                    else "Promotion removals outpaced adds"
                ),
                detail=(
                    f"{promotion_removals_since_baseline} removals versus {promotion_adds_since_baseline} adds were recorded since your last visit."
                    if since_at
                    else f"{promotion_removals} removals versus {promotion_adds} adds were recorded in the last 7 days."
                ),
                severity="medium",
                tone="amber",
                action_label="Inspect promotion removals",
                replay_key="promotion_removals",
            )
        )

    if total_promoted < 3 and ((since_at and promotion_removals_since_baseline > 0) or promotion_removals > 0):
        alerts.append(
            _make_alert(
                id="promotion-inventory-thin",
                signature=(
                    f"since-visit:{total_promoted}:{promotion_removals_since_baseline}"
                    if since_at
                    else f"rolling:{total_promoted}:{promotion_removals}"
                ),
                title="Promoted inventory is getting thin",
                detail=f"Only {total_promoted} promoted listings are active right now after recent removals.",
                severity="monitor",
                tone="sky",
                action_label="Open promoted listings",
                replay_key="promoted_listings",
            )
        )

    return alerts


def list_monetization_watchlist_events(*, limit: int = 20) -> list[MonetizationWatchlistEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "monetization_watchlist_events",
            query={
                "select": MONETIZATION_WATCHLIST_EVENT_SELECT,
                "order": "created_at.desc",
                "limit": str(limit),
            },
            use_service_role=True,
        )
    except SupabaseError:
        return []

    return [MonetizationWatchlistEventRead(**row) for row in rows if row.get("id")]


def _latest_watchlist_actions_by_alert_id(
    events: list[MonetizationWatchlistEventRead],
) -> dict[str, MonetizationWatchlistEventRead]:
    latest_by_alert_id: dict[str, MonetizationWatchlistEventRead] = {}
    for event in events:
        if event.alert_id not in latest_by_alert_id:
            latest_by_alert_id[event.alert_id] = event
    return latest_by_alert_id


def list_monetization_watchlist_summaries(
    *,
    since_at: datetime | None = None,
    limit: int = 20,
    state: str | None = None,
) -> list[MonetizationWatchlistSummaryRead]:
    alerts = list_monetization_watchlist_alerts(since_at=since_at)
    events = list_monetization_watchlist_events(limit=max(limit * 3, 20))
    latest_by_alert_id = _latest_watchlist_actions_by_alert_id(events)

    summaries: list[MonetizationWatchlistSummaryRead] = []
    for alert in alerts[:limit]:
        latest_event = latest_by_alert_id.get(alert.id)
        acknowledged = bool(
            latest_event
            and latest_event.action == "acknowledged"
            and latest_event.alert_signature == alert.signature
        )
        latest_action = latest_event.action if latest_event else "active"
        latest_action_at = latest_event.created_at if latest_event else alert.created_at

        if state == "active" and acknowledged:
            continue
        if state == "acknowledged" and not acknowledged:
            continue

        summaries.append(
            MonetizationWatchlistSummaryRead(
                id=alert.id,
                signature=alert.signature,
                title=alert.title,
                detail=alert.detail,
                severity=alert.severity,
                tone=alert.tone,
                action_label=alert.action_label,
                replay_key=alert.replay_key,
                acknowledged=acknowledged,
                latest_action=latest_action,
                latest_action_at=latest_action_at,
                created_at=alert.created_at,
            )
        )

    return summaries


def _record_monetization_watchlist_event(
    *,
    alert: MonetizationWatchlistAlertRead,
    actor_user_id: str,
    action: str,
) -> list[dict[str, object]]:
    supabase = get_supabase_client()
    payload = {
        "alert_id": alert.id,
        "alert_signature": alert.signature,
        "actor_user_id": actor_user_id,
        "action": action,
        "alert_title": alert.title,
        "alert_severity": alert.severity,
    }
    try:
        rows = supabase.insert("monetization_watchlist_events", payload, use_service_role=True)
    except SupabaseError:
        return []

    return rows if isinstance(rows, list) else [rows]


def _find_current_monetization_watchlist_alert(alert_id: str, since_at: datetime | None = None) -> MonetizationWatchlistAlertRead | None:
    for alert in list_monetization_watchlist_alerts(since_at=since_at):
        if alert.id == alert_id:
            return alert
    return None


def acknowledge_monetization_watchlist_alert(
    alert_id: str,
    *,
    actor_user_id: str,
    since_at: datetime | None = None,
) -> list[dict[str, object]]:
    alert = _find_current_monetization_watchlist_alert(alert_id, since_at=since_at)
    if alert is None:
        return []
    return _record_monetization_watchlist_event(alert=alert, actor_user_id=actor_user_id, action="acknowledged")


def clear_monetization_watchlist_alert_acknowledgement(
    alert_id: str,
    *,
    actor_user_id: str,
    since_at: datetime | None = None,
) -> list[dict[str, object]]:
    alert = _find_current_monetization_watchlist_alert(alert_id, since_at=since_at)
    if alert is None:
        return []
    return _record_monetization_watchlist_event(alert=alert, actor_user_id=actor_user_id, action="cleared")
