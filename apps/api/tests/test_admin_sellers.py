import unittest
from unittest.mock import patch

from app.routers.admin import read_admin_sellers


class AdminSellerLookupEndpointTests(unittest.TestCase):
    def test_reads_admin_seller_lookup_results(self):
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
        ) as mocked_search:
            result = read_admin_sellers(query="tamales", limit=5, current_user=None)

        self.assertEqual(result[0]["slug"], "south-dallas-tamales")
        mocked_search.assert_called_once_with(query_text="tamales", limit=5)


if __name__ == "__main__":
    unittest.main()
