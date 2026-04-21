import unittest
from unittest.mock import patch

from app.routers.admin import update_listing_promotion


class AdminPromotionEndpointTests(unittest.TestCase):
    def test_promotion_endpoint_requires_admin(self):
        payload = {"id": "listing-1", "is_promoted": True}

        with patch("app.routers.admin.set_listing_promotion", return_value=payload) as mocked_set_promotion:
            result = update_listing_promotion("listing-1", True, current_user=None)

        self.assertEqual(result["id"], "listing-1")
        self.assertTrue(result["is_promoted"])
        mocked_set_promotion.assert_called_once_with("listing-1", True)


if __name__ == "__main__":
    unittest.main()
