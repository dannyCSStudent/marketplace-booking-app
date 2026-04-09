import unittest
from unittest.mock import patch

from app.services.sellers import search_sellers


class SellerSearchTests(unittest.TestCase):
    def test_searches_sellers_by_slug_or_display_name(self):
        class _Supabase:
            def __init__(self):
                self.select_calls = []

            def select(self, table, **kwargs):
                self.select_calls.append((table, kwargs))
                return [
                    {
                        "id": "seller-1",
                        "display_name": "South Dallas Tamales",
                        "slug": "south-dallas-tamales",
                        "is_verified": True,
                        "city": "Dallas",
                        "state": "TX",
                        "country": "USA",
                    }
                ]

        fake_supabase = _Supabase()

        with patch("app.services.sellers.get_supabase_client", return_value=fake_supabase):
            sellers = search_sellers("tamales", limit=5)

        self.assertEqual(len(sellers), 1)
        self.assertEqual(sellers[0].slug, "south-dallas-tamales")
        self.assertEqual(fake_supabase.select_calls[0][0], "seller_profiles")
        self.assertEqual(
            fake_supabase.select_calls[0][1]["query"]["or"],
            "display_name.ilike.*tamales*,slug.ilike.*tamales*",
        )


if __name__ == "__main__":
    unittest.main()
