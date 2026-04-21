from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.reviews import (
    ReviewCreate,
    ReviewLookup,
    ReviewModerationEventRead,
    ReviewModerationItem,
    ReviewAnomalyRead,
    ReviewAnomalySellerSummaryRead,
    ReviewRead,
    ReviewReportCreate,
    ReviewReportRead,
    ReviewReportStatusUpdate,
    ReviewResponseAiAssistResponse,
    ReviewResponseAiAssistSuggestion,
    ReviewSellerResponseUpdate,
    ReviewVisibilityUpdate,
)
from app.services.notification_delivery_worker import process_notification_delivery_rows


REPORT_SELECT = (
    "id,review_id,reporter_id,reason,notes,status,moderator_note,resolution_reason,assignee_user_id,assigned_at,is_escalated,escalated_at,created_at,"
    "reviews(id,rating,comment,seller_id,seller_response,seller_responded_at,is_hidden,hidden_at,created_at,"
    "seller_profiles(display_name,slug)),"
    "review_report_events(id,actor_user_id,action,note,created_at)"
)

ALLOWED_RESOLUTION_REASONS = {
    "abusive",
    "spam",
    "policy_violation",
    "left_public",
    "restored_after_review",
    "insufficient_evidence",
}

REVIEW_RESPONSE_REMINDER_WINDOW_DAYS = 7


def _serialize_review(row: dict) -> ReviewRead:
    return ReviewRead(
        id=row["id"],
        rating=row["rating"],
        comment=row.get("comment"),
        seller_response=row.get("seller_response"),
        seller_responded_at=row.get("seller_responded_at"),
        is_hidden=row.get("is_hidden") or False,
        hidden_at=row.get("hidden_at"),
        created_at=row["created_at"],
    )


def _require_single_transaction_target(*, order_id: str | None, booking_id: str | None) -> None:
    if bool(order_id) == bool(booking_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of order_id or booking_id",
        )


def _select_existing_review(
    *,
    current_user: CurrentUser,
    order_id: str | None,
    booking_id: str | None,
) -> ReviewRead | None:
    supabase = get_supabase_client()
    query = {
        "select": "id,rating,comment,seller_response,seller_responded_at,is_hidden,hidden_at,created_at",
        "reviewer_id": f"eq.{current_user.id}",
    }
    if order_id:
        query["order_id"] = f"eq.{order_id}"
    if booking_id:
        query["booking_id"] = f"eq.{booking_id}"

    try:
        row = supabase.select(
            "reviews",
            query=query,
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            return None
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return _serialize_review(row)


def get_my_review_lookup(
    current_user: CurrentUser,
    *,
    order_id: str | None = None,
    booking_id: str | None = None,
) -> ReviewLookup:
    _require_single_transaction_target(order_id=order_id, booking_id=booking_id)
    review = _select_existing_review(
        current_user=current_user,
        order_id=order_id,
        booking_id=booking_id,
    )
    return ReviewLookup(review=review)


def _get_review_target(
    *,
    table: str,
    transaction_id: str,
    current_user: CurrentUser,
) -> dict:
    supabase = get_supabase_client()
    try:
        return supabase.select(
            table,
            query={
                "select": "id,buyer_id,seller_id,status",
                "id": f"eq.{transaction_id}",
                "buyer_id": f"eq.{current_user.id}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"{table[:-1].capitalize()} not found",
            ) from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _refresh_seller_review_metrics(*, seller_id: str) -> None:
    supabase = get_supabase_client()
    try:
        review_rows = supabase.select(
            "reviews",
            query={
                "select": "rating",
                "seller_id": f"eq.{seller_id}",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    review_count = len(review_rows)
    average_rating = (
        round(sum(row["rating"] for row in review_rows) / review_count, 2)
        if review_count > 0
        else 0
    )

    try:
        supabase.update(
            "seller_profiles",
            {
                "review_count": review_count,
                "average_rating": average_rating,
            },
            query={"id": f"eq.{seller_id}"},
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _queue_review_response_reminder_notifications(*, seller_id: str) -> None:
    supabase = get_supabase_client()

    try:
        seller_row = supabase.select(
            "seller_profiles",
            query={
                "select": "id,user_id,display_name,slug",
                "id": f"eq.{seller_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
        pending_reviews = supabase.select(
            "reviews",
            query={
                "select": "id,rating,comment,seller_response,seller_responded_at,is_hidden,created_at",
                "seller_id": f"eq.{seller_id}",
                "is_hidden": "eq.false",
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
        profile_row = supabase.select(
            "profiles",
            query={
                "select": "id,email_notifications_enabled,push_notifications_enabled",
                "id": f"eq.{seller_row['user_id']}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError:
        return

    pending_visible_reviews = [
        review
        for review in pending_reviews
        if not review.get("seller_response") and not review.get("is_hidden")
    ]
    if not pending_visible_reviews:
        return

    def _parse_review_time(value: object) -> datetime:
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                pass
        return datetime.now(timezone.utc)

    latest_pending_review = max(
        pending_visible_reviews,
        key=lambda review: _parse_review_time(review.get("created_at")),
    )
    latest_review_ids = ",".join(
        review["id"]
        for review in sorted(
            pending_visible_reviews,
            key=lambda review: _parse_review_time(review.get("created_at")),
            reverse=True,
        )[:3]
    )
    event_signature = "|".join(
        [
            seller_id,
            str(len(pending_visible_reviews)),
            str(latest_pending_review["id"]),
            str(latest_pending_review.get("created_at") or ""),
            latest_review_ids,
        ]
    )
    event_id = f"review-response-reminder:{event_signature}"

    try:
        recent_rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "recipient_user_id,event_id",
                "recipient_user_id": f"eq.{seller_row['user_id']}",
                "order": "created_at.desc",
                "limit": "100",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return

    if any(row.get("event_id") == event_id for row in recent_rows):
        return

    reminder_preview = latest_pending_review.get("comment") or "A buyer left a review that still needs your response."
    subject = f"Review response reminder for {seller_row.get('display_name') or seller_row.get('slug')}"
    body = f"You have {len(pending_visible_reviews)} review{'s' if len(pending_visible_reviews) != 1 else ''} waiting for a seller response."
    html = (
        f"<p>Review response reminder for <strong>{seller_row.get('display_name') or seller_row.get('slug')}</strong>.</p>"
        f"<p><strong>Pending reviews:</strong> {len(pending_visible_reviews)}</p>"
        f"<p><strong>Latest comment:</strong> {reminder_preview}</p>"
        f"<p>{body}</p>"
    )

    deliveries: list[dict[str, object]] = []
    payload = {
        "alert_type": "review_response_reminder",
        "seller_id": seller_id,
        "seller_slug": seller_row.get("slug"),
        "seller_display_name": seller_row.get("display_name"),
        "pending_review_count": len(pending_visible_reviews),
        "latest_review_id": latest_pending_review["id"],
        "latest_review_rating": latest_pending_review.get("rating"),
        "latest_review_comment": latest_pending_review.get("comment"),
        "alert_signature": event_id,
        "subject": subject,
        "body": body,
        "html": html,
    }

    if profile_row.get("email_notifications_enabled", True):
        deliveries.append(
            {
                "recipient_user_id": seller_row["user_id"],
                "transaction_kind": "review",
                "transaction_id": seller_id,
                "event_id": event_id,
                "channel": "email",
                "delivery_status": "queued",
                "payload": payload,
            }
        )

    if profile_row.get("push_notifications_enabled", True):
        deliveries.append(
            {
                "recipient_user_id": seller_row["user_id"],
                "transaction_kind": "review",
                "transaction_id": seller_id,
                "event_id": event_id,
                "channel": "push",
                "delivery_status": "queued",
                "payload": payload,
            }
        )

    if not deliveries:
        return

    try:
        inserted_rows = supabase.insert("notification_deliveries", deliveries, use_service_role=True)
    except SupabaseError:
        return

    if inserted_rows:
        try:
            process_notification_delivery_rows(inserted_rows)
        except Exception:
            return


def create_review(current_user: CurrentUser, payload: ReviewCreate) -> ReviewRead:
    _require_single_transaction_target(order_id=payload.order_id, booking_id=payload.booking_id)

    if payload.order_id:
        target = _get_review_target(
            table="orders",
            transaction_id=payload.order_id,
            current_user=current_user,
        )
        if target["status"] != "completed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Reviews are only allowed after an order is completed",
            )
    else:
        target = _get_review_target(
            table="bookings",
            transaction_id=payload.booking_id or "",
            current_user=current_user,
        )
        if target["status"] != "completed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Reviews are only allowed after a booking is completed",
            )

    existing_review = _select_existing_review(
        current_user=current_user,
        order_id=payload.order_id,
        booking_id=payload.booking_id,
    )
    if existing_review:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A review already exists for this transaction",
        )

    supabase = get_supabase_client()
    try:
        rows = supabase.insert(
            "reviews",
            {
                "reviewer_id": current_user.id,
                "seller_id": target["seller_id"],
                "order_id": payload.order_id,
                "booking_id": payload.booking_id,
                "rating": payload.rating,
                "comment": payload.comment,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    _refresh_seller_review_metrics(seller_id=target["seller_id"])
    try:
        _queue_review_response_reminder_notifications(seller_id=target["seller_id"])
    except Exception:
        pass
    return _serialize_review(rows[0])


def update_review_seller_response(
    current_user: CurrentUser,
    review_id: str,
    payload: ReviewSellerResponseUpdate,
) -> ReviewRead:
    supabase = get_supabase_client()

    try:
        seller = supabase.select(
            "seller_profiles",
            query={
                "select": "id",
                "user_id": f"eq.{current_user.id}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller profile not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    seller_response = payload.seller_response.strip() if payload.seller_response else None

    try:
        rows = supabase.update(
            "reviews",
            {
                "seller_response": seller_response,
                "seller_responded_at": datetime.now(timezone.utc).isoformat() if seller_response else None,
            },
            query={
                "id": f"eq.{review_id}",
                "seller_id": f"eq.{seller['id']}",
                "select": "id,rating,comment,seller_response,seller_responded_at,is_hidden,hidden_at,created_at",
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")

    try:
        _queue_review_response_reminder_notifications(seller_id=seller["id"])
    except Exception:
        pass
    return _serialize_review(rows[0])


def generate_review_response_ai_assist(
    current_user: CurrentUser,
    review_id: str,
) -> ReviewResponseAiAssistResponse:
    supabase = get_supabase_client()

    try:
        seller = supabase.select(
            "seller_profiles",
            query={
                "select": "id",
                "user_id": f"eq.{current_user.id}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller profile not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    try:
        review_row = supabase.select(
            "reviews",
            query={
                "select": "id,rating,comment,seller_response,seller_responded_at",
                "id": f"eq.{review_id}",
                "seller_id": f"eq.{seller['id']}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    comment = str(review_row.get("comment") or "").strip()
    rating = int(review_row.get("rating") or 0)
    comment_excerpt = comment[:120].rstrip()

    if rating >= 4:
        opening = "Thanks for the kind review"
        response = "We appreciate your support and are glad the experience felt strong."
    elif rating <= 2:
        opening = "Thanks for sharing this feedback"
        response = "We are sorry this missed the mark and want to make it right."
    else:
        opening = "Thanks for the thoughtful feedback"
        response = "We appreciate the note and will keep improving the experience."

    if comment_excerpt:
        response += f" We especially noticed: “{comment_excerpt}”."

    response += " Please reach out if you want to share any more details."

    summary = "Calibrated for review tone and recent response history."
    if rating >= 4:
        summary = "Positive reply suggested for a strong review."
    elif rating <= 2:
        summary = "Recovery-focused reply suggested for a low review."
    elif comment_excerpt:
        summary = "Balanced reply suggested around the buyer's comment."

    suggestion = ReviewResponseAiAssistSuggestion(
        suggested_response=f"{opening}. {response}",
        summary=summary,
    )
    return ReviewResponseAiAssistResponse(review_id=review_id, suggestion=suggestion)


def create_review_report(
    current_user: CurrentUser,
    review_id: str,
    payload: ReviewReportCreate,
) -> ReviewReportRead:
    supabase = get_supabase_client()

    try:
        supabase.select(
            "reviews",
            query={
                "select": "id",
                "id": f"eq.{review_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    try:
        rows = supabase.insert(
            "review_reports",
            {
                "review_id": review_id,
                "reporter_id": current_user.id,
                "reason": payload.reason.strip(),
                "notes": payload.notes,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        if exc.status_code == 409:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You already reported this review",
            ) from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    row = rows[0]
    try:
        supabase.insert(
            "review_report_events",
            {
                "report_id": row["id"],
                "actor_user_id": current_user.id,
                "action": "reported",
                "note": payload.notes,
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    try:
        _queue_review_anomaly_notifications(list_review_anomalies(limit=8))
    except Exception:
        pass
    return ReviewReportRead(
        id=row["id"],
        review_id=row["review_id"],
        reporter_id=row["reporter_id"],
        reason=row["reason"],
        notes=row.get("notes"),
        status=row["status"],
        created_at=row["created_at"],
    )


def list_review_reports(*, status_filter: str | None = None) -> list[ReviewModerationItem]:
    supabase = get_supabase_client()
    query = {
        "select": REPORT_SELECT,
        "order": "created_at.desc",
    }
    if status_filter and status_filter != "all":
        query["status"] = f"eq.{status_filter}"

    try:
        rows = supabase.select("review_reports", query=query, use_service_role=True)
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    items: list[ReviewModerationItem] = []
    for row in rows:
        review_row = row.get("reviews") or {}
        seller_row = review_row.get("seller_profiles") or {}
        history = [
            ReviewModerationEventRead(
                id=event["id"],
                actor_user_id=event["actor_user_id"],
                action=event["action"],
                note=event.get("note"),
                created_at=event["created_at"],
            )
            for event in sorted(
                row.get("review_report_events", []),
                key=lambda event: event.get("created_at") or "",
                reverse=True,
            )
        ]
        items.append(
            ReviewModerationItem(
                id=row["id"],
                review_id=row["review_id"],
                reporter_id=row["reporter_id"],
                seller_id=review_row.get("seller_id"),
                reason=row["reason"],
                notes=row.get("notes"),
                status=row["status"],
                moderator_note=row.get("moderator_note"),
                resolution_reason=row.get("resolution_reason"),
                assignee_user_id=row.get("assignee_user_id"),
                assigned_at=row.get("assigned_at"),
                is_escalated=row.get("is_escalated") or False,
                escalated_at=row.get("escalated_at"),
                created_at=row["created_at"],
                review=_serialize_review(review_row),
                seller_display_name=seller_row.get("display_name"),
                seller_slug=seller_row.get("slug"),
                history=history,
            )
        )

    return items


def list_review_anomalies(*, limit: int = 8) -> list[ReviewAnomalyRead]:
    reports = list_review_reports(status_filter=None)
    grouped: dict[str, list[ReviewModerationItem]] = {}
    for report in reports:
        if not report.seller_id:
            continue

        grouped.setdefault(report.seller_id, []).append(report)

    anomalies: list[ReviewAnomalyRead] = []

    for seller_id, seller_reports in grouped.items():
        active_reports = [report for report in seller_reports if report.status != "resolved"]
        if not active_reports:
            continue

        open_reports = [report for report in active_reports if report.status == "open"]
        escalated_reports = [report for report in active_reports if report.is_escalated]
        hidden_open_reports = [
            report for report in active_reports if report.review.is_hidden and report.status != "resolved"
        ]
        latest_report = max(active_reports, key=lambda report: _normalize_datetime(report.created_at))
        latest_report_at = _normalize_datetime(latest_report.created_at)
        recent_reports = [
            report
            for report in active_reports
            if latest_report_at - _normalize_datetime(report.created_at) <= timedelta(days=3)
        ]

        if len(active_reports) < 2 and not hidden_open_reports:
            continue

        seller_row = active_reports[0]

        reasons: list[str] = []
        if hidden_open_reports:
            reasons.append("Hidden reviews still open")
        if escalated_reports:
            reasons.append(
                f"{len(escalated_reports)} escalated report{'s' if len(escalated_reports) != 1 else ''}"
            )
        if len(active_reports) >= 3:
            reasons.append(f"{len(active_reports)} active reports")
        if len(recent_reports) >= 3:
            reasons.append("Recent report burst")
        if not reasons:
            reasons.append("Repeat seller reporting")

        severity = "monitor"
        if hidden_open_reports or len(active_reports) >= 4 or len(escalated_reports) >= 2:
            severity = "high"
        elif len(active_reports) >= 2 or len(escalated_reports) >= 1 or len(recent_reports) >= 3:
            severity = "medium"

        anomalies.append(
            ReviewAnomalyRead(
                seller_id=seller_id,
                seller_slug=seller_row.seller_slug,
                seller_display_name=seller_row.seller_display_name,
                active_report_count=len(active_reports),
                open_report_count=len(open_reports),
                escalated_report_count=len(escalated_reports),
                hidden_open_count=len(hidden_open_reports),
                recent_report_count=len(recent_reports),
                latest_report_at=latest_report.created_at,
                severity=severity,
                reasons=reasons,
            )
        )

    return sorted(
        anomalies,
        key=lambda anomaly: (
            0 if anomaly.severity == "high" else 1 if anomaly.severity == "medium" else 2,
            -anomaly.active_report_count,
            -anomaly.escalated_report_count,
            -anomaly.hidden_open_count,
            -anomaly.recent_report_count,
            -_normalize_datetime(anomaly.latest_report_at).timestamp(),
            (anomaly.seller_display_name or anomaly.seller_slug or anomaly.seller_id).lower(),
        ),
    )[:limit]


def list_review_anomaly_seller_summaries(*, limit: int = 6) -> list[ReviewAnomalySellerSummaryRead]:
    anomalies = list_review_anomalies(limit=max(1, min(limit * 2, 20)))
    summaries = [
        ReviewAnomalySellerSummaryRead(
            seller_id=anomaly.seller_id,
            seller_slug=anomaly.seller_slug,
            seller_display_name=anomaly.seller_display_name,
            active_report_count=anomaly.active_report_count,
            latest_report_at=anomaly.latest_report_at,
            severity=anomaly.severity,
            reasons=anomaly.reasons,
        )
        for anomaly in anomalies
    ]
    return sorted(
        summaries,
        key=lambda summary: (
            0 if summary.severity == "high" else 1 if summary.severity == "medium" else 2,
            -summary.active_report_count,
            -_normalize_datetime(summary.latest_report_at).timestamp(),
            (summary.seller_display_name or summary.seller_slug or summary.seller_id).lower(),
        ),
    )[:limit]


def acknowledge_review_anomaly(seller_id: str, *, actor_user_id: str) -> list[dict]:
    return _update_review_anomaly_acknowledgement(
        seller_id=seller_id,
        acknowledged=True,
        actor_user_id=actor_user_id,
    )


def clear_review_anomaly_acknowledgement(seller_id: str, *, actor_user_id: str) -> list[dict]:
    return _update_review_anomaly_acknowledgement(
        seller_id=seller_id,
        acknowledged=False,
        actor_user_id=actor_user_id,
    )


def _normalize_datetime(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _build_review_anomaly_signature(anomaly: ReviewAnomalyRead) -> str:
    return "|".join(
        [
            str(anomaly.seller_id).strip(),
            str(anomaly.severity).strip(),
            str(anomaly.active_report_count).strip(),
            str(anomaly.open_report_count).strip(),
            str(anomaly.escalated_report_count).strip(),
            str(anomaly.hidden_open_count).strip(),
            str(anomaly.recent_report_count).strip(),
            anomaly.latest_report_at.isoformat(),
            *(reason.strip() for reason in anomaly.reasons),
        ]
    )


def _update_review_anomaly_acknowledgement(
    *,
    seller_id: str,
    acknowledged: bool,
    actor_user_id: str,
) -> list[dict]:
    supabase = get_supabase_client()
    anomaly = next((item for item in list_review_anomalies(limit=20) if item.seller_id == seller_id), None)
    if anomaly is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review anomaly not found")

    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                ),
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    matching_rows = [
        row
        for row in rows
        if (row.get("payload") or {}).get("alert_type") == "review_anomaly"
        and str((row.get("payload") or {}).get("seller_id") or "").strip() == seller_id
    ]
    if not matching_rows:
        return []

    updated_rows: list[dict] = []
    for row in matching_rows:
        payload = dict(row.get("payload") or {})
        now = datetime.now(timezone.utc).isoformat()
        if acknowledged:
            payload["acknowledged_at"] = now
            payload["acknowledged_by_user_id"] = actor_user_id
            payload["acknowledged_signature"] = payload.get("alert_signature") or payload.get("acknowledged_signature")
        else:
            payload.pop("acknowledged_at", None)
            payload.pop("acknowledged_by_user_id", None)
            payload.pop("acknowledged_signature", None)

        try:
            updated = supabase.update(
                "notification_deliveries",
                {"payload": payload},
                query={
                    "id": f"eq.{row['id']}",
                    "select": (
                        "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                        "delivery_status,payload,failure_reason,attempts,sent_at,created_at"
                    ),
                },
                use_service_role=True,
            )
        except SupabaseError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        if updated:
            updated_rows.extend(updated)

    return updated_rows


def _queue_review_anomaly_notifications(anomalies: list[ReviewAnomalyRead]) -> None:
    actionable_anomalies = [anomaly for anomaly in anomalies if anomaly.severity in {"high", "medium"}]
    if not actionable_anomalies:
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

    profile_prefs = {row.get("id"): row for row in profile_rows if row.get("id")}
    existing_events = {
        (row.get("recipient_user_id"), row.get("event_id"))
        for row in recent_rows
        if row.get("recipient_user_id") and row.get("event_id")
    }

    deliveries: list[dict[str, object]] = []
    for anomaly in actionable_anomalies:
        seller_label = anomaly.seller_display_name or anomaly.seller_slug or anomaly.seller_id
        event_id = f"review-anomaly:{_build_review_anomaly_signature(anomaly)}"
        subject = f"Review anomaly for {seller_label}"
        body = f"{seller_label} has {anomaly.active_report_count} active review reports."
        html = (
            f"<p>Review anomaly for <strong>{seller_label}</strong>.</p>"
            f"<p><strong>Severity:</strong> {anomaly.severity}</p>"
            f"<p><strong>Reasons:</strong> {'; '.join(anomaly.reasons)}</p>"
            f"<p>{body}</p>"
        )

        for admin_id in admin_ids:
            if (admin_id, event_id) in existing_events:
                continue

            prefs = profile_prefs.get(admin_id, {})
            payload = {
                "alert_type": "review_anomaly",
                "seller_id": anomaly.seller_id,
                "seller_slug": anomaly.seller_slug,
                "seller_display_name": anomaly.seller_display_name,
                "active_report_count": anomaly.active_report_count,
                "open_report_count": anomaly.open_report_count,
                "escalated_report_count": anomaly.escalated_report_count,
                "hidden_open_count": anomaly.hidden_open_count,
                "recent_report_count": anomaly.recent_report_count,
                "latest_report_at": anomaly.latest_report_at.isoformat(),
                "severity": anomaly.severity,
                "reasons": anomaly.reasons,
                "alert_signature": event_id,
                "subject": subject,
                "body": body,
                "html": html,
            }

            if prefs.get("email_notifications_enabled", True):
                deliveries.append(
                    {
                        "recipient_user_id": admin_id,
                        "transaction_kind": "review",
                        "transaction_id": anomaly.seller_id,
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
                        "transaction_kind": "review",
                        "transaction_id": anomaly.seller_id,
                        "event_id": event_id,
                        "channel": "push",
                        "delivery_status": "queued",
                        "payload": payload,
                    }
                )

    if not deliveries:
        return

    try:
        inserted_rows = supabase.insert("notification_deliveries", deliveries, use_service_role=True)
    except SupabaseError:
        return

    if inserted_rows:
        try:
            process_notification_delivery_rows(inserted_rows)
        except Exception:
            return


def update_review_report_status(
    current_user: CurrentUser,
    report_id: str,
    payload: ReviewReportStatusUpdate,
) -> ReviewModerationItem:
    supabase = get_supabase_client()
    if payload.status not in {"open", "triaged", "resolved"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported report status")

    resolution_reason = payload.resolution_reason.strip() if payload.resolution_reason else None
    if resolution_reason and resolution_reason not in ALLOWED_RESOLUTION_REASONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported resolution reason",
        )

    if payload.status == "resolved" and not resolution_reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Resolved reports require a resolution reason",
        )

    if payload.status != "resolved":
        resolution_reason = None

    assignee_user_id = payload.assignee_user_id.strip() if payload.assignee_user_id else None

    try:
        current_row = supabase.select(
            "review_reports",
            query={
                "id": f"eq.{report_id}",
                "select": REPORT_SELECT,
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    is_escalated = (
        payload.is_escalated
        if payload.is_escalated is not None
        else bool(current_row.get("is_escalated"))
    )

    try:
        rows = supabase.update(
            "review_reports",
            {
                "status": payload.status,
                "moderator_note": payload.moderator_note,
                "resolution_reason": resolution_reason,
                "assignee_user_id": assignee_user_id,
                "assigned_at": datetime.now(timezone.utc).isoformat() if assignee_user_id else None,
                "is_escalated": is_escalated,
                "escalated_at": datetime.now(timezone.utc).isoformat() if is_escalated else None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            query={
                "id": f"eq.{report_id}",
                "select": REPORT_SELECT,
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    assignment_changed = current_row.get("assignee_user_id") != assignee_user_id
    escalation_changed = bool(current_row.get("is_escalated")) != is_escalated
    status_changed = (
        current_row.get("status") != payload.status
        or (current_row.get("moderator_note") or None) != (payload.moderator_note or None)
        or (current_row.get("resolution_reason") or None) != resolution_reason
    )

    if payload.assignee_user_id is not None and assignment_changed:
        try:
            supabase.insert(
                "review_report_events",
                {
                    "report_id": report_id,
                    "actor_user_id": current_user.id,
                    "action": "assignment:assigned" if assignee_user_id else "assignment:cleared",
                    "note": assignee_user_id or "Unassigned",
                },
                use_service_role=True,
            )
        except SupabaseError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if payload.is_escalated is not None and escalation_changed:
        try:
            supabase.insert(
                "review_report_events",
                {
                    "report_id": report_id,
                    "actor_user_id": current_user.id,
                    "action": "escalation:enabled" if is_escalated else "escalation:cleared",
                    "note": payload.moderator_note or ("Escalated" if is_escalated else "Escalation cleared"),
                },
                use_service_role=True,
            )
        except SupabaseError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if status_changed:
        try:
            supabase.insert(
                "review_report_events",
                {
                    "report_id": report_id,
                    "actor_user_id": current_user.id,
                    "action": f"status:{payload.status}",
                    "note": (
                        f"Resolution: {resolution_reason}. {payload.moderator_note}"
                        if resolution_reason and payload.moderator_note
                        else f"Resolution: {resolution_reason}"
                        if resolution_reason
                        else payload.moderator_note
                    ),
                },
                use_service_role=True,
            )
        except SupabaseError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    try:
        _queue_review_anomaly_notifications(list_review_anomalies(limit=8))
    except Exception:
        pass
    row = rows[0]
    review_row = row.get("reviews") or {}
    seller_row = review_row.get("seller_profiles") or {}
    history = [
        ReviewModerationEventRead(
            id=event["id"],
            actor_user_id=event["actor_user_id"],
            action=event["action"],
            note=event.get("note"),
            created_at=event["created_at"],
        )
        for event in sorted(
            row.get("review_report_events", []),
            key=lambda event: event.get("created_at") or "",
            reverse=True,
        )
    ]
    return ReviewModerationItem(
        id=row["id"],
        review_id=row["review_id"],
        reporter_id=row["reporter_id"],
        seller_id=review_row.get("seller_id"),
        reason=row["reason"],
        notes=row.get("notes"),
        status=row["status"],
        moderator_note=row.get("moderator_note"),
        resolution_reason=row.get("resolution_reason"),
        assignee_user_id=row.get("assignee_user_id"),
        assigned_at=row.get("assigned_at"),
        is_escalated=row.get("is_escalated") or False,
        escalated_at=row.get("escalated_at"),
        created_at=row["created_at"],
        review=_serialize_review(review_row),
        seller_display_name=seller_row.get("display_name"),
        seller_slug=seller_row.get("slug"),
        history=history,
    )


def update_review_visibility(
    current_user: CurrentUser,
    review_id: str,
    payload: ReviewVisibilityUpdate,
) -> ReviewRead:
    supabase = get_supabase_client()
    try:
        rows = supabase.update(
            "reviews",
            {
                "is_hidden": payload.is_hidden,
                "hidden_at": datetime.now(timezone.utc).isoformat() if payload.is_hidden else None,
            },
            query={
                "id": f"eq.{review_id}",
                "select": "id,rating,comment,seller_response,seller_responded_at,is_hidden,hidden_at,created_at",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")

    if payload.report_id:
        try:
            supabase.insert(
                "review_report_events",
                {
                    "report_id": payload.report_id,
                    "actor_user_id": current_user.id,
                    "action": "visibility:hidden" if payload.is_hidden else "visibility:restored",
                    "note": "Review hidden from public surfaces"
                    if payload.is_hidden
                    else "Review restored to public surfaces",
                },
                use_service_role=True,
            )
        except SupabaseError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    try:
        _queue_review_anomaly_notifications(list_review_anomalies(limit=8))
    except Exception:
        pass
    return _serialize_review(rows[0])
