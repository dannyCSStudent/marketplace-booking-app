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


if __name__ == "__main__":
    unittest.main()
