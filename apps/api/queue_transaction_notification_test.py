import argparse
from datetime import datetime, timedelta, timezone

from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client
from app.services.notifications import queue_transaction_notification_jobs

ORDER_NEXT_STATUS = {
    "pending": "confirmed",
    "confirmed": "preparing",
    "preparing": "ready",
    "ready": "completed",
    "completed": "completed",
}

BOOKING_NEXT_STATUS = {
    "requested": "confirmed",
    "confirmed": "in_progress",
    "in_progress": "completed",
    "completed": "completed",
    "declined": "declined",
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Queue a real transaction notification tied to the buyer's latest order or booking."
    )
    parser.add_argument("--email", required=True, help="Email address of an existing auth user.")
    parser.add_argument(
        "--kind",
        choices=["order", "booking"],
        default="order",
        help="Transaction kind to target.",
    )
    parser.add_argument(
        "--status",
        default=None,
        help="Optional explicit next status. If omitted, the helper advances to the next logical seller status.",
    )
    parser.add_argument(
        "--note",
        default=None,
        help="Optional seller response note to attach to the transaction update.",
    )
    args = parser.parse_args()

    supabase = get_supabase_client()
    buyer = _find_auth_user_by_email(supabase, args.email)
    if not buyer:
        raise SystemExit(f"No auth user found for {args.email}")

    transaction = _find_latest_transaction(
        supabase=supabase,
        buyer_id=buyer["id"],
        kind=args.kind,
    )
    if not transaction:
        transaction = _create_seed_transaction(
            supabase=supabase,
            buyer_id=buyer["id"],
            kind=args.kind,
        )

    current_status = transaction["status"]
    next_status = args.status or _resolve_next_status(
        kind=args.kind,
        current_status=current_status,
    )
    note = args.note or _default_note(kind=args.kind, status=next_status)

    _update_transaction(
        supabase=supabase,
        kind=args.kind,
        transaction_id=transaction["id"],
        next_status=next_status,
        note=note,
    )
    event = _insert_status_event(
        supabase=supabase,
        kind=args.kind,
        transaction_id=transaction["id"],
        next_status=next_status,
        note=note,
    )

    queue_transaction_notification_jobs(
        recipient_user_id=buyer["id"],
        transaction_kind=args.kind,
        transaction_id=transaction["id"],
        event_id=event["id"],
        status_value=next_status,
        actor_role="seller",
        note=note,
    )

    print(
        {
            "queued": 1,
            "email": args.email,
            "kind": args.kind,
            "transaction_id": transaction["id"],
            "from_status": current_status,
            "to_status": next_status,
            "event_id": event["id"],
        }
    )


def _find_auth_user_by_email(supabase, email: str) -> dict | None:
    try:
        users = supabase.list_auth_users()
    except SupabaseError as exc:
        raise SystemExit(f"Unable to list auth users: {exc.detail}") from exc

    for user in users:
        if user.get("email") == email:
            return user

    return None


def _find_latest_transaction(*, supabase, buyer_id: str, kind: str) -> dict | None:
    table = "orders" if kind == "order" else "bookings"
    try:
        rows = supabase.select(
            table,
            query={
                "select": "id,status",
                "buyer_id": f"eq.{buyer_id}",
                "order": "created_at.desc",
                "limit": "1",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise SystemExit(f"Unable to load latest {kind}: {exc.detail}") from exc

    return rows[0] if rows else None


def _create_seed_transaction(*, supabase, buyer_id: str, kind: str) -> dict:
    seller = _find_seed_seller(supabase)
    if not seller:
        raise SystemExit("No seller profile found to create a seed transaction")

    if kind == "order":
        listing = _find_seed_listing(supabase=supabase, seller_id=seller["id"], kind="order")
        if not listing:
            raise SystemExit("No active product or hybrid listing found to create a seed order")

        order = supabase.insert(
            "orders",
            {
                "buyer_id": buyer_id,
                "seller_id": seller["id"],
                "fulfillment": "pickup",
                "subtotal_cents": listing["price_cents"],
                "total_cents": listing["price_cents"],
                "currency": listing.get("currency") or "USD",
                "notes": "Auto-created receipt test order.",
            },
            use_service_role=True,
        )[0]
        supabase.insert(
            "order_items",
            {
                "order_id": order["id"],
                "listing_id": listing["id"],
                "quantity": 1,
                "unit_price_cents": listing["price_cents"],
                "total_price_cents": listing["price_cents"],
            },
            use_service_role=True,
        )
        supabase.insert(
            "order_status_events",
            {
                "order_id": order["id"],
                "status": order["status"],
                "actor_role": "buyer",
                "note": "Auto-created receipt test order.",
            },
            use_service_role=True,
        )
        return {
            "id": order["id"],
            "status": order["status"],
        }

    listing = _find_seed_listing(supabase=supabase, seller_id=seller["id"], kind="booking")
    if not listing:
        raise SystemExit("No active service or hybrid listing found to create a seed booking")

    scheduled_start = datetime.now(timezone.utc) + timedelta(hours=30)
    duration_minutes = listing.get("duration_minutes") or 60
    scheduled_end = scheduled_start + timedelta(minutes=duration_minutes)
    booking = supabase.insert(
        "bookings",
        {
            "buyer_id": buyer_id,
            "seller_id": seller["id"],
            "listing_id": listing["id"],
            "scheduled_start": scheduled_start.isoformat(),
            "scheduled_end": scheduled_end.isoformat(),
            "total_cents": listing.get("price_cents"),
            "currency": listing.get("currency") or "USD",
            "notes": "Auto-created receipt test booking.",
        },
        use_service_role=True,
    )[0]
    supabase.insert(
        "booking_status_events",
        {
            "booking_id": booking["id"],
            "status": booking["status"],
            "actor_role": "buyer",
            "note": "Auto-created receipt test booking.",
        },
        use_service_role=True,
    )
    return {
        "id": booking["id"],
        "status": booking["status"],
    }


def _find_seed_seller(supabase) -> dict | None:
    try:
        rows = supabase.select(
            "seller_profiles",
            query={
                "select": "id,user_id,display_name",
                "order": "created_at.asc",
                "limit": "1",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise SystemExit(f"Unable to load seller profile: {exc.detail}") from exc

    return rows[0] if rows else None


def _find_seed_listing(*, supabase, seller_id: str, kind: str) -> dict | None:
    type_filter = "in.(product,hybrid)" if kind == "order" else "in.(service,hybrid)"
    try:
        rows = supabase.select(
            "listings",
            query={
                "select": "id,price_cents,currency,status,type,duration_minutes",
                "seller_id": f"eq.{seller_id}",
                "status": "eq.active",
                "type": type_filter,
                "order": "created_at.asc",
                "limit": "1",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise SystemExit(f"Unable to load seed listing: {exc.detail}") from exc

    return rows[0] if rows else None


def _resolve_next_status(*, kind: str, current_status: str) -> str:
    transitions = ORDER_NEXT_STATUS if kind == "order" else BOOKING_NEXT_STATUS
    return transitions.get(current_status, current_status)


def _default_note(*, kind: str, status: str) -> str:
    if kind == "order":
        return f"Seller moved your order to {status.replace('_', ' ')}."

    return f"Seller moved your booking to {status.replace('_', ' ')}."


def _update_transaction(*, supabase, kind: str, transaction_id: str, next_status: str, note: str) -> None:
    table = "orders" if kind == "order" else "bookings"
    payload = {
        "status": next_status,
        "seller_response_note": note,
    }
    try:
        supabase.update(
            table,
            payload,
            query={"id": f"eq.{transaction_id}"},
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise SystemExit(f"Unable to update {kind} {transaction_id}: {exc.detail}") from exc


def _insert_status_event(*, supabase, kind: str, transaction_id: str, next_status: str, note: str) -> dict:
    table = "order_status_events" if kind == "order" else "booking_status_events"
    transaction_key = "order_id" if kind == "order" else "booking_id"
    try:
        rows = supabase.insert(
            table,
            {
                transaction_key: transaction_id,
                "status": next_status,
                "actor_role": "seller",
                "note": note,
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise SystemExit(f"Unable to insert {kind} status event: {exc.detail}") from exc

    return rows[0]


if __name__ == "__main__":
    main()
