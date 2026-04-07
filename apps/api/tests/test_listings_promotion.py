import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.services.listings import set_listing_promotion


class ListingPromotionServiceTests(unittest.TestCase):
    def test_sets_listing_promotion_record(self):
        class _Supabase:
            def update(self, *args, **kwargs):
                return [
                    {
                        "id": "listing-1",
                        "seller_id": "seller-1",
                        "title": "Test",
                        "slug": "test",
                        "description": "desc",
                        "type": "product",
                        "status": "active",
                        "price_cents": 1000,
                        "currency": "USD",
                        "inventory_count": 5,
                        "requires_booking": False,
                        "duration_minutes": None,
                        "is_local_only": True,
                        "city": None,
                        "state": None,
                        "country": None,
                        "pickup_enabled": False,
                        "meetup_enabled": False,
                        "delivery_enabled": False,
                        "shipping_enabled": False,
                        "lead_time_hours": None,
                        "images": [],
                        "created_at": "now",
                        "updated_at": "now",
                        "last_operating_adjustment_at": None,
                        "last_operating_adjustment_summary": None,
                        "last_pricing_comparison_scope": None,
                        "available_today": False,
                        "is_new_listing": False,
                        "recent_transaction_count": 0,
                        "is_promoted": True,
                    }
                ]

        with patch("app.services.listings.get_supabase_client", return_value=_Supabase()):
            listing = set_listing_promotion("listing-1", True)

        self.assertEqual(listing.id, "listing-1")
        self.assertTrue(listing.is_promoted)

    def test_set_listing_promotion_raises_not_found(self):
        class _Supabase:
            def update(self, *args, **kwargs):
                return []

        with patch("app.services.listings.get_supabase_client", return_value=_Supabase()):
            with self.assertRaises(HTTPException) as exc:
                set_listing_promotion("listing-404", False)

        self.assertEqual(exc.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
