import unittest
from unittest.mock import patch

from app.dependencies.auth import CurrentUser
from app.schemas.profiles import ProfileUpdate
from app.services.profiles import update_my_profile


class _FakeSupabase:
    def __init__(self):
        self.update_calls = []

    def update(self, table, changes, query=None, access_token=None):
        self.update_calls.append((table, changes, query, access_token))
        return [
            {
                "id": "user-1",
                "full_name": "Admin User",
                "username": "admin-user",
                "phone": None,
                "city": "Dallas",
                "state": "TX",
                "country": "US",
                "email_notifications_enabled": True,
                "push_notifications_enabled": True,
                "marketing_notifications_enabled": False,
                "expo_push_token": None,
                "admin_monetization_preferences": changes.get("admin_monetization_preferences", {}),
                "admin_delivery_ops_preferences": changes.get("admin_delivery_ops_preferences", {}),
            }
        ]


class ProfileServiceTests(unittest.TestCase):
    def test_update_profile_persists_admin_monetization_preferences(self):
        fake_supabase = _FakeSupabase()
        current_user = CurrentUser(id="user-1", access_token="token-1")

        with patch("app.services.profiles.get_supabase_client", return_value=fake_supabase):
            result = update_my_profile(
                current_user,
                ProfileUpdate(
                    admin_monetization_preferences={
                        "pinned_preset_ids": ["workflow-subscription-risk-review"],
                        "quick_access_filter": "workflows",
                    }
                ),
            )

        self.assertEqual(fake_supabase.update_calls[0][0], "profiles")
        self.assertEqual(
            fake_supabase.update_calls[0][1]["admin_monetization_preferences"],
            {
                "pinned_preset_ids": ["workflow-subscription-risk-review"],
                "quick_access_filter": "workflows",
            },
        )
        self.assertEqual(
            result.admin_monetization_preferences,
            {
                "pinned_preset_ids": ["workflow-subscription-risk-review"],
                "quick_access_filter": "workflows",
            },
        )

    def test_update_profile_persists_admin_delivery_ops_preferences(self):
        fake_supabase = _FakeSupabase()
        current_user = CurrentUser(id="user-1", access_token="token-1")

        with patch("app.services.profiles.get_supabase_client", return_value=fake_supabase):
            result = update_my_profile(
                current_user,
                ProfileUpdate(
                    admin_delivery_ops_preferences={
                        "preset": "failed_only",
                        "status": "failed",
                        "channel": "push",
                        "mode": "atomic",
                    }
                ),
            )

        self.assertEqual(fake_supabase.update_calls[0][0], "profiles")
        self.assertEqual(
            fake_supabase.update_calls[0][1]["admin_delivery_ops_preferences"],
            {
                "preset": "failed_only",
                "status": "failed",
                "channel": "push",
                "mode": "atomic",
            },
        )
        self.assertEqual(
            result.admin_delivery_ops_preferences,
            {
                "preset": "failed_only",
                "status": "failed",
                "channel": "push",
                "mode": "atomic",
            },
        )


if __name__ == "__main__":
    unittest.main()
