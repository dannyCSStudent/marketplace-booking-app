import unittest
from unittest.mock import patch

from app.schemas.listings import ListingQueryParams
from app.services.listings import list_public_listings


class ListingPriorityVisibilityTests(unittest.TestCase):
    def test_priority_visibility_boosts_non_promoted_listing_order(self):
        fake_supabase = _PriorityVisibilitySupabase(
            listing_rows=[
                _listing_row(
                    "listing-promoted",
                    "seller-promoted",
                    "Promoted listing",
                    is_promoted=True,
                    created_at="2026-04-07T10:00:00+00:00",
                ),
                _listing_row(
                    "listing-priority",
                    "seller-priority",
                    "Priority listing",
                    created_at="2026-04-07T09:00:00+00:00",
                ),
                _listing_row(
                    "listing-standard",
                    "seller-standard",
                    "Standard listing",
                    created_at="2026-04-07T11:00:00+00:00",
                ),
            ],
            priority_rows=[
                {
                    "seller_id": "seller-priority",
                    "subscription_tiers": {"priority_visibility": True},
                }
            ],
        )

        with patch("app.services.listings.get_supabase_client", return_value=fake_supabase):
            response = list_public_listings(ListingQueryParams())

        self.assertEqual(
            [listing.id for listing in response.items],
            ["listing-promoted", "listing-priority", "listing-standard"],
        )


class _PriorityVisibilitySupabase:
    def __init__(self, *, listing_rows, priority_rows):
        self.listing_rows = listing_rows
        self.priority_rows = priority_rows

    def select(self, table, query=None, **kwargs):
        if table == "listings":
            return self.listing_rows
        if table == "order_items":
            return []
        if table == "bookings":
            return []
        if table == "listing_availability":
            return []
        if table == "seller_subscriptions":
            return self.priority_rows
        raise AssertionError(f"Unexpected select for {table}")


def _listing_row(
    listing_id: str,
    seller_id: str,
    title: str,
    *,
    is_promoted: bool = False,
    created_at: str,
):
    return {
        "id": listing_id,
        "seller_id": seller_id,
        "category_id": None,
        "title": title,
        "slug": title.lower().replace(" ", "-"),
        "description": "desc",
        "type": "product",
        "status": "active",
        "price_cents": 1000,
        "currency": "USD",
        "inventory_count": 5,
        "requires_booking": False,
        "duration_minutes": None,
        "is_local_only": True,
        "city": "Dallas",
        "state": "TX",
        "country": "USA",
        "pickup_enabled": True,
        "meetup_enabled": False,
        "delivery_enabled": False,
        "shipping_enabled": False,
        "is_promoted": is_promoted,
        "lead_time_hours": None,
        "created_at": created_at,
        "updated_at": created_at,
        "last_operating_adjustment_at": None,
        "last_operating_adjustment_summary": None,
        "last_pricing_comparison_scope": None,
        "category": None,
        "images": [],
    }


if __name__ == "__main__":
    unittest.main()
