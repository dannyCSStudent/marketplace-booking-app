import unittest
from unittest.mock import patch

from app.routers.admin import read_pricing_scope_counts, read_pricing_scope_listings


class PricingScopeSummaryTests(unittest.TestCase):
    def test_pricing_scope_summary_requires_admin(self):
        with patch("app.routers.admin.list_pricing_scope_counts", return_value=[{"scope": "Category", "count": 42}]) as mocked_counts:
            result = read_pricing_scope_counts(current_user=None)

        self.assertEqual(result, [{"scope": "Category", "count": 42}])
        mocked_counts.assert_called_once_with()

    def test_pricing_scope_items_requires_admin(self):
        with patch(
            "app.routers.admin.list_pricing_scope_listings",
            return_value=[
                {
                    "id": "listing-1",
                    "seller_id": "seller-1",
                    "title": "Tamales Tray",
                    "slug": "tamales-tray",
                    "description": None,
                    "type": "product",
                    "status": "active",
                    "price_cents": 2400,
                    "currency": "USD",
                    "category_id": None,
                    "category": None,
                    "requires_booking": False,
                    "duration_minutes": None,
                    "city": "Dallas",
                    "state": "TX",
                    "country": "USA",
                    "pickup_enabled": True,
                    "meetup_enabled": False,
                    "delivery_enabled": False,
                    "shipping_enabled": False,
                    "lead_time_hours": None,
                    "images": [],
                    "created_at": "2026-04-09T10:00:00Z",
                    "updated_at": "2026-04-09T10:00:00Z",
                    "available_today": True,
                    "is_new_listing": False,
                    "recent_transaction_count": 2,
                    "is_promoted": False,
                }
            ],
        ) as mocked_listings:
            result = read_pricing_scope_listings(scope="Category", current_user=None)

        self.assertEqual(result[0]["id"], "listing-1")
        mocked_listings.assert_called_once_with("Category")


if __name__ == "__main__":
    unittest.main()
