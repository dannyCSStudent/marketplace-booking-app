import unittest
from unittest.mock import patch

from app.services.notification_delivery_maintenance import prune_notification_deliveries


class NotificationDeliveryMaintenanceTests(unittest.TestCase):
    def test_prunes_old_sent_and_failed_rows(self):
        fake_supabase = _FakeSupabase(
            delete_results=[
                [{"id": "sent-1"}, {"id": "sent-2"}],
                [{"id": "failed-1"}],
            ]
        )
        settings = type(
            "Settings",
            (),
            {
                "notification_sent_retention_days": 14,
                "notification_failed_retention_days": 30,
            },
        )()

        with (
            patch("app.services.notification_delivery_maintenance.get_supabase_client", return_value=fake_supabase),
            patch("app.services.notification_delivery_maintenance.get_settings", return_value=settings),
        ):
            result = prune_notification_deliveries()

        self.assertEqual(result["deleted_sent"], 2)
        self.assertEqual(result["deleted_failed"], 1)
        self.assertEqual(result["deleted_total"], 3)
        self.assertEqual(len(fake_supabase.delete_calls), 2)


class _FakeSupabase:
    def __init__(self, *, delete_results):
        self._delete_results = list(delete_results)
        self.delete_calls = []

    def delete(self, table, **kwargs):
        self.delete_calls.append((table, kwargs))
        if not self._delete_results:
            raise AssertionError("Unexpected delete call")
        return self._delete_results.pop(0)


if __name__ == "__main__":
    unittest.main()
