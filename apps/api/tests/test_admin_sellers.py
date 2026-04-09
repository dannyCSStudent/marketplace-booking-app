import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.dependencies.admin import require_admin_user
from app.main import app


class AdminSellerLookupEndpointTests(unittest.TestCase):
    def test_reads_admin_seller_lookup_results(self):
        client = TestClient(app)
        app.dependency_overrides[require_admin_user] = lambda: None

        with patch(
            "app.routers.admin.search_sellers",
            return_value=[
                {
                    "id": "seller-1",
                    "display_name": "South Dallas Tamales",
                    "slug": "south-dallas-tamales",
                    "is_verified": True,
                    "city": "Dallas",
                    "state": "TX",
                    "country": "USA",
                }
            ],
        ):
            response = client.get("/admin/sellers?query=tamales&limit=5")

        app.dependency_overrides.clear()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["slug"], "south-dallas-tamales")


if __name__ == "__main__":
    unittest.main()
