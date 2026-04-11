import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.dependencies.admin import require_admin_user
from app.main import app


class PricingScopeSummaryTests(unittest.TestCase):
    def test_pricing_scope_summary_requires_admin(self):
        client = TestClient(app)
        app.dependency_overrides[require_admin_user] = lambda: None
        with patch("app.routers.admin.list_pricing_scope_counts", return_value=[{"scope": "Category", "count": 42}]):
            response = client.get("/admin/listings/pricing-scope-summary")
        app.dependency_overrides.clear()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [{"scope": "Category", "count": 42}])

    def test_pricing_scope_items_requires_admin(self):
        client = TestClient(app)
        app.dependency_overrides[require_admin_user] = lambda: None
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
        ):
            response = client.get("/admin/listings/pricing-scope-items?scope=Category")
        app.dependency_overrides.clear()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["id"], "listing-1")


if __name__ == "__main__":
    unittest.main()
