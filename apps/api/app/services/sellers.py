from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.services.notification_delivery_worker import process_notification_delivery_rows
from app.services.notification_deliveries import queue_seller_profile_completion_notifications
from app.schemas.reviews import ReviewRead
from app.schemas.sellers import (
    SellerCreate,
    SellerLookupRead,
    SellerProfileCompletionRead,
    SellerRead,
    SellerTrustInterventionRead,
    SellerTrustScoreRead,
    SellerUpdate,
)

SELLER_SELECT = (
    "id,user_id,display_name,slug,bio,is_verified,accepts_custom_orders,"
    "average_rating,review_count,city,state,country"
)

TRUST_TREND_WINDOW_DAYS = 30


def _parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _build_profile_completion(row: dict) -> SellerProfileCompletionRead:
    seller_display_name = str(row.get("display_name") or "Seller").strip() or "Seller"
    seller_slug = str(row.get("slug") or "").strip()
    missing_fields: list[str] = []

    if not str(row.get("bio") or "").strip():
        missing_fields.append("Bio")

    has_location = all(str(row.get(field) or "").strip() for field in ("city", "state", "country"))
    if not has_location:
        missing_fields.append("Location")

    if not bool(row.get("is_verified", False)):
        missing_fields.append("Verification")

    total_checks = 3
    completed_checks = total_checks - len(missing_fields)
    completion_percent = round((completed_checks / total_checks) * 100) if total_checks > 0 else 0

    if missing_fields:
        summary = f"Complete {', '.join(field.lower() for field in missing_fields)} to strengthen the seller profile."
    else:
        summary = "The seller profile has the basics in place for discovery and trust surfaces."

    return SellerProfileCompletionRead(
        seller_id=str(row.get("id") or ""),
        seller_slug=seller_slug,
        seller_display_name=seller_display_name,
        total_checks=total_checks,
        completed_checks=completed_checks,
        missing_checks=len(missing_fields),
        completion_percent=completion_percent,
        missing_fields=missing_fields,
        is_complete=not missing_fields,
        summary=summary,
    )


def _score_trust_window(
    *,
    seller_rating: float,
    seller_review_count: int,
    is_verified: bool,
    review_rows: list[dict],
    order_rows: list[dict],
    booking_rows: list[dict],
    delivery_rows: list[dict],
) -> dict[str, object]:
    review_count = len(review_rows)
    reviewed_rows = [row for row in review_rows if not row.get("is_hidden")]
    hidden_review_count = sum(1 for row in review_rows if row.get("is_hidden"))
    responded_review_count = sum(1 for row in reviewed_rows if row.get("seller_response"))
    response_rate = responded_review_count / review_count if review_count > 0 else 0

    total_transactions = len(order_rows) + len(booking_rows)
    completed_transactions = sum(1 for row in order_rows if row.get("status") == "completed") + sum(
        1 for row in booking_rows if row.get("status") == "completed"
    )
    completion_rate = completed_transactions / total_transactions if total_transactions > 0 else 0

    sent_deliveries = sum(1 for row in delivery_rows if row.get("delivery_status") == "sent")
    failed_deliveries = sum(1 for row in delivery_rows if row.get("delivery_status") == "failed")
    delivery_total = sent_deliveries + failed_deliveries
    delivery_success_rate = sent_deliveries / delivery_total if delivery_total > 0 else 0

    if review_count == 0 and total_transactions == 0 and delivery_total == 0:
        summary = "Not enough activity yet to build a trust score."
        label = "New seller"
        return {
            "score": 50 if is_verified else 45,
            "label": label,
            "summary": summary,
            "risk_level": "watch" if is_verified else "elevated",
            "risk_reasons": ["Not enough activity yet to evaluate trust."],
            "review_quality_score": 0,
            "response_rate_score": 0,
            "completion_score": 0,
            "delivery_reliability_score": 0,
            "verified_bonus": 5 if is_verified else 0,
            "review_count": 0,
            "response_rate": 0,
            "completion_rate": 0,
            "delivery_success_rate": 0,
            "hidden_review_count": 0,
            "completed_transactions": 0,
            "total_transactions": 0,
        }

    review_quality_score = round((max(0, min(seller_rating, 5)) / 5) * 40)
    if review_count > 0:
        confidence_multiplier = min(review_count / 10, 1)
        review_quality_score = round(review_quality_score * (0.6 + (0.4 * confidence_multiplier)))
    else:
        review_quality_score = 0

    response_rate_score = round(response_rate * 20)
    completion_score = round(completion_rate * 20)
    delivery_reliability_score = round(delivery_success_rate * 15)
    verified_bonus = 5 if is_verified else 0
    hidden_penalty = min(hidden_review_count * 4, 10)

    score = (
        20
        + review_quality_score
        + response_rate_score
        + completion_score
        + delivery_reliability_score
        + verified_bonus
        - hidden_penalty
    )
    score = max(0, min(100, score))

    if score >= 90:
        label = "Trusted seller"
    elif score >= 75:
        label = "Strong seller"
    elif score >= 60:
        label = "Reliable seller"
    elif score >= 45:
        label = "Mixed signal"
    else:
        label = "Needs attention"

    if score >= 75:
        risk_level = "low"
    elif score >= 60:
        risk_level = "watch"
    elif score >= 45:
        risk_level = "elevated"
    else:
        risk_level = "critical"

    summary = (
        "Trust score blends review quality, seller response, completed transactions, and "
        "delivery reliability."
    )

    risk_reasons: list[str] = []
    if review_count == 0:
        risk_reasons.append("No reviews yet")
    elif response_rate < 0.5:
        risk_reasons.append("Seller response coverage is low")
    elif response_rate < 0.8:
        risk_reasons.append("Seller response coverage could be stronger")

    if total_transactions == 0:
        risk_reasons.append("No completed transactions yet")
    elif completion_rate < 0.75:
        risk_reasons.append("Completion rate is slipping")
    elif completion_rate < 0.9:
        risk_reasons.append("Completion rate could improve")

    if delivery_total == 0:
        risk_reasons.append("No delivery history yet")
    elif delivery_success_rate < 0.75:
        risk_reasons.append("Delivery reliability needs attention")
    elif delivery_success_rate < 0.9:
        risk_reasons.append("Delivery reliability is only moderate")

    if hidden_review_count > 0:
        risk_reasons.append("Hidden reviews are present")

    if review_quality_score < 12 and review_count > 0:
        risk_reasons.append("Review quality signal is weak")

    if not is_verified and score < 75:
        risk_reasons.append("Seller is not verified")

    return {
        "score": score,
        "label": label,
        "summary": summary,
        "risk_level": risk_level,
        "risk_reasons": risk_reasons,
        "review_quality_score": review_quality_score,
        "response_rate_score": response_rate_score,
        "completion_score": completion_score,
        "delivery_reliability_score": delivery_reliability_score,
        "verified_bonus": verified_bonus,
        "review_count": review_count,
        "response_rate": round(response_rate, 2),
        "completion_rate": round(completion_rate, 2),
        "delivery_success_rate": round(delivery_success_rate, 2),
        "hidden_review_count": hidden_review_count,
        "completed_transactions": completed_transactions,
        "total_transactions": total_transactions,
    }


def _build_seller_trust_score(
    *,
    seller_id: str,
    seller_user_id: str,
    seller_rating: float,
    seller_review_count: int,
    is_verified: bool,
) -> SellerTrustScoreRead:
    supabase = get_supabase_client()

    try:
        review_rows = supabase.select(
            "reviews",
            query={
                "select": "seller_response,is_hidden,created_at",
                "seller_id": f"eq.{seller_id}",
            },
            use_service_role=True,
        )
        order_rows = supabase.select(
            "orders",
            query={
                "select": "status,created_at",
                "seller_id": f"eq.{seller_id}",
            },
            use_service_role=True,
        )
        booking_rows = supabase.select(
            "bookings",
            query={
                "select": "status,created_at",
                "seller_id": f"eq.{seller_id}",
            },
            use_service_role=True,
        )
        delivery_rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "delivery_status,created_at",
                "recipient_user_id": f"eq.{seller_user_id}",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    overall = _score_trust_window(
        seller_rating=seller_rating,
        seller_review_count=seller_review_count,
        is_verified=is_verified,
        review_rows=review_rows,
        order_rows=order_rows,
        booking_rows=booking_rows,
        delivery_rows=delivery_rows,
    )

    now = datetime.now(timezone.utc)
    recent_start = now - timedelta(days=TRUST_TREND_WINDOW_DAYS)
    previous_start = now - timedelta(days=TRUST_TREND_WINDOW_DAYS * 2)

    def _in_window(row: dict, *, start: datetime, end: datetime) -> bool:
        timestamp = _parse_timestamp(row.get("created_at"))
        return timestamp is not None and start <= timestamp < end

    recent_window = {
        "reviews": [row for row in review_rows if _in_window(row, start=recent_start, end=now)],
        "orders": [row for row in order_rows if _in_window(row, start=recent_start, end=now)],
        "bookings": [row for row in booking_rows if _in_window(row, start=recent_start, end=now)],
        "deliveries": [row for row in delivery_rows if _in_window(row, start=recent_start, end=now)],
    }
    previous_window = {
        "reviews": [row for row in review_rows if _in_window(row, start=previous_start, end=recent_start)],
        "orders": [row for row in order_rows if _in_window(row, start=previous_start, end=recent_start)],
        "bookings": [row for row in booking_rows if _in_window(row, start=previous_start, end=recent_start)],
        "deliveries": [row for row in delivery_rows if _in_window(row, start=previous_start, end=recent_start)],
    }

    recent_score = _score_trust_window(
        seller_rating=seller_rating,
        seller_review_count=seller_review_count,
        is_verified=is_verified,
        review_rows=recent_window["reviews"],
        order_rows=recent_window["orders"],
        booking_rows=recent_window["bookings"],
        delivery_rows=recent_window["deliveries"],
    )["score"]
    previous_score = _score_trust_window(
        seller_rating=seller_rating,
        seller_review_count=seller_review_count,
        is_verified=is_verified,
        review_rows=previous_window["reviews"],
        order_rows=previous_window["orders"],
        booking_rows=previous_window["bookings"],
        delivery_rows=previous_window["deliveries"],
    )["score"]

    if (
        not recent_window["reviews"]
        and not recent_window["orders"]
        and not recent_window["bookings"]
        and not recent_window["deliveries"]
        and not previous_window["reviews"]
        and not previous_window["orders"]
        and not previous_window["bookings"]
        and not previous_window["deliveries"]
    ):
        trend_direction = "new"
        trend_summary = "No activity in the last 60 days to establish a trend."
        trend_delta = 0
    else:
        trend_delta = int(recent_score) - int(previous_score)
        if trend_delta >= 5:
            trend_direction = "improving"
        elif trend_delta <= -5:
            trend_direction = "worsening"
        else:
            trend_direction = "steady"

        if trend_direction == "improving":
            trend_summary = f"Seller trust improved by {trend_delta} points versus the prior 30-day window."
        elif trend_direction == "worsening":
            trend_summary = f"Seller trust fell by {abs(trend_delta)} points versus the prior 30-day window."
        else:
            trend_summary = f"Seller trust is steady versus the prior 30-day window ({trend_delta:+d} points)."

    return SellerTrustScoreRead(
        **overall,
        trend_direction=trend_direction,
        trend_summary=trend_summary,
        trend_delta=trend_delta,
    )


def _attach_trust_score(row: dict) -> dict:
    trust_score = _build_seller_trust_score(
        seller_id=row["id"],
        seller_user_id=row["user_id"],
        seller_rating=float(row.get("average_rating", 0) or 0),
        seller_review_count=int(row.get("review_count", 0) or 0),
        is_verified=bool(row.get("is_verified", False)),
    )
    return {**row, "trust_score": trust_score}


def _intervention_priority(risk_level: str, trend_delta: int) -> str:
    if risk_level == "critical":
        return "high"
    if trend_delta <= -10:
        return "high"
    return "medium"


def _build_trust_alert_signature(intervention: SellerTrustInterventionRead) -> str:
    seller = intervention.seller
    risk_reasons = seller.trust_score.risk_reasons if seller.trust_score else []
    return "|".join(
        [
            str(seller.id).strip(),
            str(intervention.risk_level).strip(),
            str(intervention.trend_direction).strip(),
            str(intervention.intervention_priority).strip(),
            str(intervention.trend_summary).strip(),
            str(intervention.intervention_reason).strip(),
            *(str(reason).strip() for reason in risk_reasons),
        ]
    )


def _queue_seller_trust_intervention_notifications(
    interventions: list[SellerTrustInterventionRead],
) -> None:
    if not interventions:
        return

    settings = get_settings()
    admin_ids = [
        admin_id
        for admin_id in settings.admin_user_ids
        if (settings.admin_user_roles or {}).get(admin_id, "").lower() in {"trust", "owner"}
    ]
    if not admin_ids:
        admin_ids = list(settings.admin_user_ids)
    if not admin_ids:
        return

    supabase = get_supabase_client()
    try:
        profile_rows = supabase.select(
            "profiles",
            query={
                "select": "id,email_notifications_enabled,push_notifications_enabled",
                "id": f"in.({','.join(admin_ids)})",
            },
            use_service_role=True,
        )
        recent_rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "recipient_user_id,event_id,payload,delivery_status,created_at",
                "recipient_user_id": f"in.({','.join(admin_ids)})",
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return

    profile_prefs = {
        row.get("id"): row
        for row in profile_rows
        if row.get("id")
    }
    existing_events = {
        (row.get("recipient_user_id"), row.get("event_id"))
        for row in recent_rows
        if row.get("recipient_user_id") and row.get("event_id")
    }

    deliveries: list[dict[str, object]] = []
    for intervention in interventions:
        seller = intervention.seller
        event_id = (
            f"seller-trust-intervention:{seller.id}:{intervention.risk_level}:{intervention.trend_direction}"
        )
        subject = f"Trust alert for {seller.display_name}"
        body = intervention.intervention_reason
        html = (
            f"<p>Trust alert for <strong>{seller.display_name}</strong>.</p>"
            f"<p><strong>Risk:</strong> {intervention.risk_level}</p>"
            f"<p><strong>Trend:</strong> {intervention.trend_direction}</p>"
            f"<p>{body}</p>"
        )

        for admin_id in admin_ids:
            if (admin_id, event_id) in existing_events:
                continue

            prefs = profile_prefs.get(admin_id, {})
            payload = {
                "alert_type": "seller_trust_intervention",
                "seller_id": seller.id,
                "seller_slug": seller.slug,
                "seller_display_name": seller.display_name,
                "risk_level": intervention.risk_level,
                "trend_direction": intervention.trend_direction,
                "trend_summary": intervention.trend_summary,
                "intervention_reason": intervention.intervention_reason,
                "intervention_priority": intervention.intervention_priority,
                "risk_reasons": seller.trust_score.risk_reasons if seller.trust_score else [],
                "alert_signature": _build_trust_alert_signature(intervention),
                "subject": subject,
                "body": body,
                "html": html,
            }

            if prefs.get("email_notifications_enabled", True):
                deliveries.append(
                    {
                        "recipient_user_id": admin_id,
                        "transaction_kind": "seller",
                        "transaction_id": seller.id,
                        "event_id": event_id,
                        "channel": "email",
                        "delivery_status": "queued",
                        "payload": payload,
                    }
                )

            if prefs.get("push_notifications_enabled", True):
                deliveries.append(
                    {
                        "recipient_user_id": admin_id,
                        "transaction_kind": "seller",
                        "transaction_id": seller.id,
                        "event_id": event_id,
                        "channel": "push",
                        "delivery_status": "queued",
                        "payload": payload,
                    }
                )

    if deliveries:
        try:
            inserted_rows = supabase.insert("notification_deliveries", deliveries, use_service_role=True)
        except SupabaseError:
            return
        if inserted_rows:
            try:
                process_notification_delivery_rows(inserted_rows)
            except Exception:
                return


def list_seller_trust_interventions(limit: int = 20) -> list[SellerTrustInterventionRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "seller_profiles",
            query={
                "select": f"{SELLER_SELECT},updated_at",
                "order": "updated_at.desc",
                "limit": str(max(1, min(limit * 4, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    interventions: list[SellerTrustInterventionRead] = []
    for row in rows:
        seller = SellerRead(**_attach_trust_score(row))
        trust_score = seller.trust_score
        if trust_score is None:
            continue
        if trust_score.risk_level not in {"critical", "elevated"}:
            continue
        if trust_score.trend_direction != "worsening":
            continue

        reasons = ", ".join(trust_score.risk_reasons[:2]) if trust_score.risk_reasons else "Trust is worsening"
        interventions.append(
            SellerTrustInterventionRead(
                seller=seller,
                risk_level=trust_score.risk_level,
                trend_direction=trust_score.trend_direction,
                trend_summary=trust_score.trend_summary,
                intervention_reason=f"{trust_score.summary} {reasons}".strip(),
                intervention_priority=_intervention_priority(trust_score.risk_level, trust_score.trend_delta),
            )
        )

    interventions.sort(
        key=lambda item: (
            0 if item.risk_level == "critical" else 1,
            0 if item.trend_direction == "worsening" else 1,
            0 if item.intervention_priority == "high" else 1,
            -(item.seller.trust_score.trend_delta if item.seller.trust_score else 0),
            -(item.seller.trust_score.score if item.seller.trust_score else 0),
            item.seller.display_name.lower(),
        )
    )
    _queue_seller_trust_intervention_notifications(interventions)
    return interventions[: max(1, limit)]

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

    return SellerRead(**_attach_trust_score(row))


def get_my_seller_profile_completion(current_user: CurrentUser) -> SellerProfileCompletionRead:
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

    return _build_profile_completion(row)


def list_seller_profile_completions(
    limit: int = 24,
    state: str | None = None,
) -> list[SellerProfileCompletionRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "seller_profiles",
            query={
                "select": SELLER_SELECT,
                "order": "display_name.asc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    completions = [_build_profile_completion(row) for row in rows]
    effective_state = (state or "all").strip().lower()
    if effective_state == "complete":
        completions = [completion for completion in completions if completion.is_complete]
    elif effective_state == "incomplete":
        completions = [completion for completion in completions if not completion.is_complete]

    completions.sort(
        key=lambda item: (
            item.is_complete,
            -item.missing_checks,
            -item.completion_percent,
            item.seller_display_name.lower(),
        )
    )
    return completions[: max(1, min(limit, 100))]

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

    seller_row = rows[0]
    queue_seller_profile_completion_notifications(seller_row, _build_profile_completion(seller_row).model_dump())
    return SellerRead(**_attach_trust_score(seller_row))

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

    seller_row = rows[0]
    queue_seller_profile_completion_notifications(seller_row, _build_profile_completion(seller_row).model_dump())
    return SellerRead(**_attach_trust_score(seller_row))

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

    return SellerRead(**_attach_trust_score(row))


def get_seller_by_id(seller_id: str) -> SellerRead:
    supabase = get_supabase_client()
    try:
        row = supabase.select(
            "seller_profiles",
            query={
                "select": SELLER_SELECT,
                "id": f"eq.{seller_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller profile not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return SellerRead(**_attach_trust_score(row))


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
