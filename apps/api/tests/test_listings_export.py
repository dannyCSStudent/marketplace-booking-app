import csv
from io import StringIO

from fastapi.testclient import TestClient

from app.main import app


def test_listings_export_includes_comparison_scope():
    client = TestClient(app)
    response = client.get("/listings/export")
    assert response.status_code == 200
    payload = response.text

    reader = csv.reader(StringIO(payload))
    header = next(reader)
    assert "last_pricing_comparison_scope" in header
    # ensure there is at least a header row
    assert len(header) > 0
