import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.dependencies.admin import require_admin_user
from app.main import app


class AdminPromotionEndpointTests(unittest.TestCase):
    def test_promotion_endpoint_requires_admin(self):
        client = TestClient(app)
        app.dependency_overrides[require_admin_user] = lambda: None

        with patch("app.routers.admin.set_listing_promotion", return_value={"id": "listing-1", "seller_id": "seller-1", "title": "t", "slug": "t", "description": "desc", "type": "product", "status": "active", "price_cents": 0, "currency": "USD", "inventory_count": 0, "requires_booking": False, "duration_minutes": None, "is_local_only": True, "city": None, "state": None, "country": None, "pickup_enabled": False, "meetup_enabled": False, "delivery_enabled": False, "shipping_enabled": False, "lead_time_hours": None, "images": [], "created_at": "now", "updated_at": "now", "last_operating_adjustment_at": None, "last_operating_adjustment_summary": None, "last_pricing_comparison_scope": None, "available_today": False, "is_new_listing": False, "recent_transaction_count": 0, "is_promoted": True}):
            response = client.patch("/admin/listings/listing-1/promotion?promoted=true")

        app.dependency_overrides.clear()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "listing-1")


if __name__ == "__main__":
    unittest.main()
