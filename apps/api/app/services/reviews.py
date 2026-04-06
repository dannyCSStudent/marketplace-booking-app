from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.reviews import (
    ReviewCreate,
    ReviewLookup,
    ReviewModerationEventRead,
    ReviewModerationItem,
    ReviewRead,
    ReviewReportCreate,
    ReviewReportRead,
    ReviewReportStatusUpdate,
    ReviewSellerResponseUpdate,
    ReviewVisibilityUpdate,
)


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

    return _serialize_review(rows[0])


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

    return _serialize_review(rows[0])
