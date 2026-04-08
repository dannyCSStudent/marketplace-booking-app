import base64
import re
from collections import Counter
from datetime import datetime, timezone, timedelta
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.listings import (
    ListingAiAssistRequest,
    ListingAiAssistResponse,
    ListingAiAssistSuggestion,
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
from app.services.platform_fees import get_active_platform_fee_rate_value

LISTING_IMAGE_SELECT = "id,listing_id,image_url,alt_text,sort_order,created_at"
LISTING_SELECT = (
    "id,seller_id,category_id,title,slug,description,type,status,price_cents,currency,"
    "inventory_count,requires_booking,duration_minutes,is_local_only,city,state,country,"
    "pickup_enabled,meetup_enabled,delivery_enabled,shipping_enabled,is_promoted,lead_time_hours,"
    "created_at,updated_at,last_operating_adjustment_at,last_operating_adjustment_summary,"
    "last_pricing_comparison_scope,"
    "category:categories(name),"
    f"images:listing_images({LISTING_IMAGE_SELECT})"
)

OPERATING_ADJUSTMENT_LABELS = {
    "price_cents": "Pricing",
    "requires_booking": "Booking mode",
    "duration_minutes": "Duration",
    "lead_time_hours": "Lead time",
    "is_local_only": "Local fit",
    "pickup_enabled": "Pickup",
    "meetup_enabled": "Meetup",
    "delivery_enabled": "Delivery",
    "shipping_enabled": "Shipping",
}


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
    category = row.get("category")
    category_name: str | None = None
    if isinstance(category, dict):
        name = category.get("name")
        category_name = name if isinstance(name, str) else None
    elif isinstance(category, str):
        category_name = category

    images = sorted(
        [ListingImageRead(**image) for image in (row.get("images") or [])],
        key=lambda image: (image.sort_order, image.created_at),
    )
    return ListingRead(**{**row, "category": category_name, "images": images})


def _build_operating_adjustment_summary(
    current_row: dict[str, object],
    changes: dict[str, object],
) -> str | None:
    changed_labels: list[str] = []
    for field_name, label in OPERATING_ADJUSTMENT_LABELS.items():
        if field_name not in changes:
            continue
        if current_row.get(field_name) == changes[field_name]:
            continue
        changed_labels.append(label)

    if not changed_labels:
        return None

    return "Updated " + ", ".join(changed_labels[:3])


def _fetch_seller_profile_row(current_user: CurrentUser, supabase) -> dict[str, object] | None:
    try:
        return supabase.select(
            "seller_profiles",
            query={"select": "id", "user_id": f"eq.{current_user.id}"},
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            return None
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _require_seller_profile_id(current_user: CurrentUser, supabase) -> str:
    seller = _fetch_seller_profile_row(current_user, supabase)
    if not seller:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Seller profile not found",
        )
    return seller["id"]


def _build_location_label(
    payload: ListingAiAssistRequest,
    listing: ListingRead | None,
) -> str | None:
    parts: list[str] = []
    for value in (
        payload.city,
        payload.state,
        payload.country,
        listing.city if listing else None,
        listing.state if listing else None,
        listing.country if listing else None,
    ):
        if value:
            cleaned = str(value).strip()
            if cleaned and cleaned not in parts:
                parts.append(cleaned)

    return ", ".join(parts) if parts else None


def _tokenize_highlight_keywords(value: str | None, limit: int = 3) -> list[str]:
    if not value:
        return []

    matches = re.findall(r"[A-Za-z0-9&+'-]{3,}", value)
    normalized: list[str] = []
    for match in matches:
        token = match.strip().replace('_', ' ').title()
        if token and token not in normalized:
            normalized.append(token)
        if len(normalized) >= limit:
            break

    return normalized


def _fetch_today_availability(listing_ids: list[str], supabase) -> set[str]:
    if not listing_ids:
        return set()

    weekday = datetime.now(timezone.utc).weekday()
    now_time = datetime.now(timezone.utc).strftime("%H:%M:%S")
    query = {
        "select": "listing_id",
        "listing_id": f"in.({','.join(listing_ids)})",
        "weekday": f"eq.{weekday}",
        "start_time": f"lte.{now_time}",
        "end_time": f"gte.{now_time}",
    }
    try:
        rows = supabase.select("listing_availability", query=query, use_service_role=True)
    except SupabaseError:
        return set()

    return {row["listing_id"] for row in rows if row.get("listing_id")}


def _build_listing_ai_suggestion(
    payload: ListingAiAssistRequest,
    listing: ListingRead | None,
) -> ListingAiAssistSuggestion:
    location_label = _build_location_label(payload, listing)
    listing_type = payload.type or (listing.type if listing else None)

    base_title = (payload.title or (listing.title if listing else "Local listing")).strip()
    extras: list[str] = []
    if listing_type:
        extras.append(listing_type.replace("_", " ").title())
    if location_label:
        extras.append(location_label)
    if payload.tone:
        extras.append(payload.tone.strip().title())

    title_parts = []
    if base_title:
        title_parts.append(base_title)

    for extra in extras:
        if extra and extra not in title_parts:
            title_parts.append(extra)

    suggested_title = " · ".join(title_parts) if title_parts else "Local listing"

    description_parts: list[str] = []
    for source in (payload.description, listing.description if listing else None, payload.highlights):
        if source:
            candidate = source.strip()
            if candidate:
                description_parts.append(candidate)

    if not description_parts:
        tone_label = payload.tone or listing_type or "community"
        description_parts.append(
            f"{tone_label.capitalize()} offering built for local commerce with thoughtful details."
        )

    suggested_description = " ".join(description_parts)

    tags: list[str] = []
    if listing_type:
        tags.append(listing_type.replace("_", " ").title())
    if listing and listing.is_local_only:
        tags.append("Local Only")
    if location_label:
        tags.extend([part.strip() for part in location_label.split(",") if part.strip()])
    tags.extend(_tokenize_highlight_keywords(payload.highlights))
    if payload.tone:
        tone_tag = payload.tone.strip().title()
        if tone_tag:
            tags.append(tone_tag)

    tags = [tag for tag in dict.fromkeys(tags) if tag]
    suggested_tags = tags[:5] if tags else ["Local"]

    suggested_category_id = payload.category_id or (listing.category_id if listing else None)
    summary = (
        f"Crafted for {listing_type or 'local'} commerce"
        + (f" and centered on {location_label}." if location_label else ".")
    )

    return ListingAiAssistSuggestion(
        suggested_title=suggested_title,
        suggested_description=suggested_description,
        suggested_tags=suggested_tags,
        suggested_category_id=suggested_category_id,
        summary=summary,
    )


def _attach_available_today(rows: list[dict[str, object]], supabase) -> None:
    listing_ids = [row["id"] for row in rows if row.get("id")]
    available_today_ids = _fetch_today_availability(listing_ids, supabase)
    for row in rows:
        row["available_today"] = row.get("id") in available_today_ids


def _parse_iso_datetime(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        if value.endswith("Z"):
            try:
                return datetime.fromisoformat(value[:-1] + "+00:00")
            except ValueError:
                return None
        return None


def _attach_new_listing_flag(rows: list[dict[str, object]], reference_time: datetime) -> None:
    threshold = reference_time - timedelta(days=3)
    for row in rows:
        created_at_value = row.get("created_at")
        created_at = None
        if isinstance(created_at_value, datetime):
            created_at = created_at_value
        elif isinstance(created_at_value, str):
            created_at = _parse_iso_datetime(created_at_value)

        row["is_new_listing"] = bool(created_at and created_at >= threshold)


def _build_listing_location_hint(listing: ListingRead) -> str | None:
    parts = [listing.city, listing.state, listing.country]
    cleaned = [part.strip() for part in parts if part and part.strip()]
    return ", ".join(cleaned) if cleaned else None


def _calculate_median(prices: list[int]) -> int:
    sorted_prices = sorted(prices)
    mid = len(sorted_prices) // 2
    if len(sorted_prices) % 2 == 0:
        return (sorted_prices[mid - 1] + sorted_prices[mid]) // 2
    return sorted_prices[mid]


def _build_price_sample_query(
    listing: ListingRead,
    *,
    category_only: bool,
    local_only: bool,
) -> dict[str, str | int]:
    query: dict[str, str | int] = {
        "select": "price_cents",
        "status": "eq.active",
        "type": f"eq.{listing.type}",
        "order": "price_cents.asc",
        "limit": 50,
    }
    query["id"] = f"neq.{listing.id}"
    if category_only and listing.category_id:
        query["category_id"] = f"eq.{listing.category_id}"
    if local_only and listing.city:
        query["city"] = f"eq.{listing.city}"
    elif local_only and listing.state:
        query["state"] = f"eq.{listing.state}"
    if listing.country:
        query["country"] = f"eq.{listing.country}"

    return query


def _collect_similar_price_samples(
    listing: ListingRead,
    supabase,
) -> tuple[list[int], str]:
    sample_tiers: list[tuple[str, dict[str, str | int]]] = []

    if listing.category_id:
        sample_tiers.append(
            (
                "category + local",
                _build_price_sample_query(listing, category_only=True, local_only=True),
            )
        )
        sample_tiers.append(
            (
                "category",
                _build_price_sample_query(listing, category_only=True, local_only=False),
            )
        )

    sample_tiers.append(
        (
            "type + local",
            _build_price_sample_query(listing, category_only=False, local_only=True),
        )
    )
    sample_tiers.append(
        (
            "type",
            _build_price_sample_query(listing, category_only=False, local_only=False),
        )
    )

    seen_signatures: set[tuple[tuple[str, str | int], ...]] = set()
    for label, query in sample_tiers:
        signature = tuple(sorted(query.items()))
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)

        rows = supabase.select("listings", query=query, use_service_role=True)
        prices = [row["price_cents"] for row in rows if row.get("price_cents") is not None]
        if prices:
            return prices, label

    return [], "none"


def _format_price_sample_scope(sample_scope: str, listing: ListingRead) -> str:
    category_label = listing.category or "category"
    location_hint = _build_listing_location_hint(listing)

    if sample_scope == "category + local":
        if location_hint:
            return f"{category_label} listings in {location_hint}"
        return f"{category_label} listings nearby"

    if sample_scope == "category":
        return f"{category_label} listings"

    if sample_scope == "type + local":
        type_label = listing.type.replace("_", " ")
        if location_hint:
            return f"{type_label} listings in {location_hint}"
        return f"{type_label} listings nearby"

    type_label = listing.type.replace("_", " ")
    return f"{type_label} listings"


def _format_price_comparison_scope_label(sample_scope: str) -> str:
    if sample_scope == "category + local":
        return "Category + local"
    if sample_scope == "category":
        return "Category"
    if sample_scope == "type + local":
        return "Type + local"
    if sample_scope == "type":
        return "Type"
    return "No sample"


def _collect_recent_transaction_counts(listing_ids: list[str], supabase) -> dict[str, int]:
    if not listing_ids:
        return {}

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    threshold = week_ago.isoformat()
    quoted_ids = ",".join(f'"{listing_id}"' for listing_id in listing_ids)
    query = {
        "select": "listing_id",
        "listing_id": f"in.({quoted_ids})",
        "created_at": f"gte.{threshold}",
        "limit": "1000",
    }
    counts: Counter[str] = Counter()

    def _sum_rows(table: str) -> None:
        try:
            rows = supabase.select(table, query=query, use_service_role=True)
        except SupabaseError:
            return

        for row in rows:
            listing_id = row.get("listing_id")
            if listing_id:
                counts[listing_id] += 1

    _sum_rows("order_items")
    _sum_rows("bookings")

    return dict(counts)


def _attach_recent_transaction_counts(rows: list[dict[str, object]], supabase) -> None:
    listing_ids = [row["id"] for row in rows if row.get("id")]
    counts = _collect_recent_transaction_counts(listing_ids, supabase)
    for row in rows:
        row["recent_transaction_count"] = counts.get(row.get("id"), 0)


def _collect_priority_visibility_seller_ids(
    seller_ids: list[str],
    supabase,
) -> set[str]:
    if not seller_ids:
        return set()

    quoted_ids = ",".join(f'"{seller_id}"' for seller_id in seller_ids)
    try:
        rows = supabase.select(
            "seller_subscriptions",
            query={
                "select": "seller_id,subscription_tiers(priority_visibility)",
                "seller_id": f"in.({quoted_ids})",
                "is_active": "eq.true",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return set()

    priority_seller_ids: set[str] = set()
    for row in rows:
        seller_id = row.get("seller_id")
        tier = row.get("subscription_tiers") or {}
        if seller_id and tier.get("priority_visibility") is True:
            priority_seller_ids.add(seller_id)

    return priority_seller_ids


def _attach_priority_visibility(rows: list[dict[str, object]], supabase) -> None:
    seller_ids = [str(row["seller_id"]) for row in rows if row.get("seller_id")]
    priority_seller_ids = _collect_priority_visibility_seller_ids(seller_ids, supabase)
    for row in rows:
        row["priority_visibility_enabled"] = row.get("seller_id") in priority_seller_ids


def _listing_sort_key(row: dict[str, object]) -> tuple[object, ...]:
    recent_count = row.get("recent_transaction_count")
    if not isinstance(recent_count, int):
        recent_count = 0

    created_at = row.get("created_at")
    created_at_timestamp = 0.0
    if isinstance(created_at, datetime):
        created_at_timestamp = created_at.timestamp()
    elif isinstance(created_at, str):
        parsed = _parse_iso_datetime(created_at)
        if parsed:
            created_at_timestamp = parsed.timestamp()

    return (
        0 if row.get("is_promoted") else 1,
        0 if row.get("priority_visibility_enabled") else 1,
        -recent_count,
        0 if row.get("available_today") else 1,
        0 if row.get("is_new_listing") else 1,
        -created_at_timestamp,
    )


def _build_price_insight(
    listing: ListingRead,
    prices: list[int],
    sample_scope: str,
) -> ListingPriceInsight:
    sample_size = len(prices)
    sample_scope_label = _format_price_sample_scope(sample_scope, listing)

    if sample_size == 0:
        summary = (
            f"No active {sample_scope_label} with pricing data yet."
            if sample_scope != "none"
            else "No similar active listings with pricing data yet."
        )
        return ListingPriceInsight(
            listing_id=listing.id,
            currency=listing.currency,
            sample_size=0,
            comparison_scope=_format_price_comparison_scope_label(sample_scope),
            summary=summary,
        )

    min_price = min(prices)
    max_price = max(prices)
    avg_price = round(sum(prices) / sample_size)
    median_price = _calculate_median(prices)
    suggested_price = median_price if median_price else listing.price_cents
    summary = f"Derived from {sample_size} active {sample_scope_label}."

    return ListingPriceInsight(
        listing_id=listing.id,
        currency=listing.currency,
        sample_size=sample_size,
        comparison_scope=_format_price_comparison_scope_label(sample_scope),
        min_price_cents=min_price,
        max_price_cents=max_price,
        avg_price_cents=avg_price,
        median_price_cents=median_price,
        suggested_price_cents=suggested_price,
        summary=summary,
    )


def _collect_recent_transaction_counts(listing_ids: list[str], supabase) -> dict[str, int]:
    if not listing_ids:
        return {}

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    threshold = week_ago.isoformat()
    quoted_ids = ",".join(f'"{listing_id}"' for listing_id in listing_ids)
    query = {
        "select": "listing_id",
        "listing_id": f"in.({quoted_ids})",
        "created_at": f"gte.{threshold}",
        "limit": "1000",
    }
    counts: Counter[str] = Counter()

    def _sum_rows(table: str) -> None:
        try:
            rows = supabase.select(table, query=query, use_service_role=True)
        except SupabaseError:
            return

        for row in rows:
            listing_id = row.get("listing_id")
            if listing_id:
                counts[listing_id] += 1

    _sum_rows("order_items")
    _sum_rows("bookings")

    return dict(counts)


def _attach_recent_transaction_counts(rows: list[dict[str, object]], supabase) -> None:
    listing_ids = [row["id"] for row in rows if row.get("id")]
    counts = _collect_recent_transaction_counts(listing_ids, supabase)
    for row in rows:
        row["recent_transaction_count"] = counts.get(row.get("id"), 0)


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
        escaped_query = params.query.replace(",", r"\,")
        query["or"] = (
            f"title.ilike.*{escaped_query}*,"
            f"description.ilike.*{escaped_query}*,"
            f"city.ilike.*{escaped_query}*,"
            f"state.ilike.*{escaped_query}*,"
            f"country.ilike.*{escaped_query}*,"
            f"slug.ilike.*{escaped_query}*"
        )

    try:
        rows = supabase.select("listings", query=query, use_service_role=True)
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    reference_time = datetime.now(timezone.utc)
    _attach_available_today(rows, supabase)
    _attach_recent_transaction_counts(rows, supabase)
    _attach_new_listing_flag(rows, reference_time)
    _attach_priority_visibility(rows, supabase)
    rows.sort(key=_listing_sort_key)
    items = [_to_listing_read(row) for row in rows]
    return ListingListResponse(items=items, total=len(items))


def list_pricing_scope_counts() -> list[dict[str, object]]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "listings",
            query={
                "select": "last_pricing_comparison_scope",
                "status": "eq.active",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    counts: Counter[str] = Counter()
    for row in rows:
        scope = row.get("last_pricing_comparison_scope") or "Uncategorized"
        counts[str(scope)] += 1

    return [
        {"scope": scope, "count": count}
        for scope, count in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
    ]

def get_admin_listings() -> list[ListingRead]:
    supabase = get_supabase_client()

    try:
        rows = supabase.select(
            "listings",
            query={
                "select": LISTING_SELECT,
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    reference_time = datetime.now(timezone.utc)
    _attach_available_today(rows, supabase)
    _attach_recent_transaction_counts(rows, supabase)
    _attach_new_listing_flag(rows, reference_time)
    return [_to_listing_read(row) for row in rows]

def get_my_listings(current_user: CurrentUser) -> list[ListingRead]:
    supabase = get_supabase_client()

    seller = _fetch_seller_profile_row(current_user, supabase)
    if not seller:
        return []

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

    reference_time = datetime.now(timezone.utc)
    _attach_available_today(rows, supabase)
    _attach_recent_transaction_counts(rows, supabase)
    _attach_new_listing_flag(rows, reference_time)
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

    reference_time = datetime.now(timezone.utc)
    _attach_available_today([row], supabase)
    _attach_recent_transaction_counts([row], supabase)
    _attach_new_listing_flag([row], reference_time)
    return _to_listing_read(row)


def generate_listing_ai_assist(
    current_user: CurrentUser,
    payload: ListingAiAssistRequest,
) -> ListingAiAssistResponse:
    supabase = get_supabase_client()
    seller_id = _require_seller_profile_id(current_user, supabase)
    listing: ListingRead | None = None

    if payload.listing_id:
        try:
            row = supabase.select(
                "listings",
                query={
                    "select": LISTING_SELECT,
                    "id": f"eq.{payload.listing_id}",
                    "seller_id": f"eq.{seller_id}",
                },
                access_token=current_user.access_token,
                expect_single=True,
            )
        except SupabaseError as exc:
            if exc.status_code == 406:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Listing not found",
                ) from exc
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        listing = _to_listing_read(row)

    suggestion = _build_listing_ai_suggestion(payload, listing)

    return ListingAiAssistResponse(listing_id=payload.listing_id, suggestion=suggestion)


def get_listing_price_insight(
    current_user: CurrentUser,
    listing_id: str,
) -> ListingPriceInsight:
    supabase = get_supabase_client()
    seller_id = _require_seller_profile_id(current_user, supabase)

    try:
        row = supabase.select(
            "listings",
            query={
                "select": LISTING_SELECT,
                "id": f"eq.{listing_id}",
                "seller_id": f"eq.{seller_id}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    listing = _to_listing_read(row)
    prices, sample_scope = _collect_similar_price_samples(listing, supabase)
    return _build_price_insight(listing, prices, sample_scope)

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
        current_row = supabase.select(
            "listings",
            query={
                "select": LISTING_SELECT,
                "id": f"eq.{listing_id}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    adjustment_summary = _build_operating_adjustment_summary(current_row, changes)
    if adjustment_summary:
        changes["last_operating_adjustment_at"] = datetime.now(timezone.utc).isoformat()
        changes["last_operating_adjustment_summary"] = adjustment_summary

    if "price_cents" in changes:
        listing_obj = _to_listing_read(current_row)
        _, sample_scope = _collect_similar_price_samples(listing_obj, supabase)
        if sample_scope != "none":
            changes["last_pricing_comparison_scope"] = _format_price_comparison_scope_label(sample_scope)
        else:
            changes["last_pricing_comparison_scope"] = None

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


def set_listing_promotion(listing_id: str, promoted: bool) -> ListingRead:
    supabase = get_supabase_client()

    try:
        rows = supabase.update(
            "listings",
            {"is_promoted": promoted},
            query={
                "id": f"eq.{listing_id}",
                "select": LISTING_SELECT,
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    listing = _to_listing_read(rows[0])
    record_promotion_event(listing, promoted)
    return listing


def list_promoted_listings(limit: int = 5) -> list[dict[str, object]]:
    supabase = get_supabase_client()

    try:
        rows = supabase.select(
            "listings",
            query={
                "select": "id,title,seller_id",
                "is_promoted": "eq.true",
                "order": "updated_at.desc",
                "limit": str(limit),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return rows


def list_promoted_summary() -> list[dict[str, object]]:
    supabase = get_supabase_client()

    try:
        rows = supabase.select(
            "listings",
            query={
                "select": "type",
                "is_promoted": "eq.true",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    counts = Counter(str(row.get("type")) for row in rows if row.get("type"))

    return [{"type": listing_type, "count": count} for listing_type, count in counts.items()]


def list_promotion_events(limit: int = 20) -> list[dict[str, object]]:
    supabase = get_supabase_client()

    try:
        rows = supabase.select(
            "promotion_events",
            query={
                "select": "id,listing_id,seller_id,promoted,platform_fee_rate,created_at",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return rows


def record_promotion_event(listing: ListingRead, promoted: bool) -> None:
    supabase = get_supabase_client()
    platform_fee_rate = get_active_platform_fee_rate_value()

    payload = {
        "listing_id": listing.id,
        "seller_id": listing.seller_id,
        "promoted": promoted,
        "platform_fee_rate": str(platform_fee_rate),
    }

    try:
        supabase.insert("promotion_events", payload, use_service_role=True)
    except (SupabaseError, AttributeError):
        pass

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
