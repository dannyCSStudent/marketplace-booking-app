from __future__ import annotations

from typing import Any

from app.dependencies.supabase import get_supabase_client


SELLER_EMAIL = "demo-seller@localmarket.test"
BUYER_EMAIL = "demo-buyer@localmarket.test"
DEMO_PASSWORD = "ChangeMe123!"


def main() -> None:
    supabase = get_supabase_client()

    seller_user = get_or_create_auth_user(
        supabase,
        email=SELLER_EMAIL,
        password=DEMO_PASSWORD,
        metadata={"full_name": "Demo Seller"},
    )
    buyer_user = get_or_create_auth_user(
        supabase,
        email=BUYER_EMAIL,
        password=DEMO_PASSWORD,
        metadata={"full_name": "Demo Buyer"},
    )

    upsert_profile(
        supabase,
        user_id=seller_user["id"],
        username="demo-seller",
        full_name="Demo Seller",
        city="Dallas",
        state="TX",
        country="USA",
        role="both",
    )
    upsert_profile(
        supabase,
        user_id=buyer_user["id"],
        username="demo-buyer",
        full_name="Demo Buyer",
        city="Dallas",
        state="TX",
        country="USA",
        role="buyer",
    )

    seller_profile = get_or_create_seller_profile(
        supabase,
        user_id=seller_user["id"],
        display_name="South Dallas Tamales",
        slug="south-dallas-tamales",
        bio="Neighborhood tamales, custom trays, and event catering.",
        city="Dallas",
        state="TX",
        country="USA",
    )

    tamales_category = get_or_create_category(
        supabase,
        name="Tamales",
        slug="tamales",
    )
    catering_category = get_or_create_category(
        supabase,
        name="Catering",
        slug="catering",
    )
    welding_category = get_or_create_category(
        supabase,
        name="Welding",
        slug="welding",
    )

    get_or_create_listing(
        supabase,
        slug="dozen-red-pork-tamales",
        seller_id=seller_profile["id"],
        category_id=tamales_category["id"],
        title="Dozen Red Pork Tamales",
        description="Fresh tamales with pickup and meetup options.",
        type="product",
        status="active",
        price_cents=1800,
        inventory_count=25,
        city="Dallas",
        state="TX",
        country="USA",
        pickup_enabled=True,
        meetup_enabled=True,
        delivery_enabled=False,
        shipping_enabled=False,
        requires_booking=False,
    )
    get_or_create_listing(
        supabase,
        slug="family-party-catering-tray",
        seller_id=seller_profile["id"],
        category_id=catering_category["id"],
        title="Family Party Catering Tray",
        description="Custom tray orders for birthdays, church events, and office lunches.",
        type="hybrid",
        status="active",
        price_cents=8500,
        inventory_count=None,
        city="Dallas",
        state="TX",
        country="USA",
        pickup_enabled=True,
        meetup_enabled=False,
        delivery_enabled=True,
        shipping_enabled=False,
        requires_booking=True,
        lead_time_hours=24,
    )
    get_or_create_listing(
        supabase,
        slug="mobile-welding-repair-visit",
        seller_id=seller_profile["id"],
        category_id=welding_category["id"],
        title="Mobile Welding Repair Visit",
        description="Local welding repair appointment for gates, trailers, and small metal fixes.",
        type="service",
        status="active",
        price_cents=12500,
        inventory_count=None,
        city="Dallas",
        state="TX",
        country="USA",
        pickup_enabled=False,
        meetup_enabled=True,
        delivery_enabled=False,
        shipping_enabled=False,
        requires_booking=True,
        duration_minutes=90,
    )

    print("Seed complete.")
    print(f"Seller login: {SELLER_EMAIL} / {DEMO_PASSWORD}")
    print(f"Buyer login: {BUYER_EMAIL} / {DEMO_PASSWORD}")


def get_or_create_auth_user(
    supabase,
    *,
    email: str,
    password: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    existing_user = find_auth_user_by_email(supabase, email)
    if existing_user is not None:
        return existing_user

    return supabase.create_auth_user(
        email=email,
        password=password,
        user_metadata=metadata,
    )


def find_auth_user_by_email(supabase, email: str) -> dict[str, Any] | None:
    users = supabase.list_auth_users()
    for user in users:
        if user.get("email") == email:
            return user
    return None


def upsert_profile(
    supabase,
    *,
    user_id: str,
    username: str,
    full_name: str,
    city: str,
    state: str,
    country: str,
    role: str,
) -> dict[str, Any]:
    existing = select_one_or_none(
        supabase,
        "profiles",
        {"select": "*", "id": f"eq.{user_id}"},
    )
    payload = {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "city": city,
        "state": state,
        "country": country,
        "role": role,
    }
    if existing is None:
        return supabase.insert("profiles", payload, use_service_role=True)[0]
    return supabase.update(
        "profiles",
        payload,
        query={"id": f"eq.{user_id}", "select": "*"},
        use_service_role=True,
    )[0]


def get_or_create_seller_profile(
    supabase,
    *,
    user_id: str,
    display_name: str,
    slug: str,
    bio: str,
    city: str,
    state: str,
    country: str,
) -> dict[str, Any]:
    existing = select_one_or_none(
        supabase,
        "seller_profiles",
        {"select": "*", "user_id": f"eq.{user_id}"},
    )
    payload = {
        "user_id": user_id,
        "display_name": display_name,
        "slug": slug,
        "bio": bio,
        "city": city,
        "state": state,
        "country": country,
        "accepts_custom_orders": True,
    }
    if existing is None:
        return supabase.insert("seller_profiles", payload, use_service_role=True)[0]
    return supabase.update(
        "seller_profiles",
        payload,
        query={"user_id": f"eq.{user_id}", "select": "*"},
        use_service_role=True,
    )[0]


def get_or_create_category(supabase, *, name: str, slug: str) -> dict[str, Any]:
    existing = select_one_or_none(
        supabase,
        "categories",
        {"select": "*", "slug": f"eq.{slug}"},
    )
    payload = {"name": name, "slug": slug}
    if existing is None:
        return supabase.insert("categories", payload, use_service_role=True)[0]
    return existing


def get_or_create_listing(supabase, **payload: Any) -> dict[str, Any]:
    slug = payload["slug"]
    existing = select_one_or_none(
        supabase,
        "listings",
        {"select": "*", "slug": f"eq.{slug}"},
    )
    if existing is None:
        return supabase.insert("listings", payload, use_service_role=True)[0]
    return supabase.update(
        "listings",
        payload,
        query={"slug": f"eq.{slug}", "select": "*"},
        use_service_role=True,
    )[0]


def select_one_or_none(supabase, table: str, query: dict[str, str]) -> dict[str, Any] | None:
    rows = supabase.select(table, query=query, use_service_role=True)
    if not rows:
        return None
    return rows[0]


if __name__ == "__main__":
    main()
