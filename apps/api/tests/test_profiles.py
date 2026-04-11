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
                "admin_review_moderation_preferences": changes.get(
                    "admin_review_moderation_preferences",
                    {},
                ),
                "admin_transaction_support_preferences": changes.get(
                    "admin_transaction_support_preferences",
                    {},
                ),
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

    def test_update_profile_persists_admin_review_moderation_preferences(self):
        fake_supabase = _FakeSupabase()
        current_user = CurrentUser(id="user-1", access_token="token-1")

        with patch("app.services.profiles.get_supabase_client", return_value=fake_supabase):
            result = update_my_profile(
                current_user,
                ProfileUpdate(
                    admin_review_moderation_preferences={
                        "preset": "escalated_only",
                        "status": "all",
                        "assignee": "unassigned",
                        "priority": "escalated",
                        "activity_log": [
                            {
                                "id": "entry-1",
                                "kind": "watchlist",
                                "label": "Opened escalated watchlist",
                            }
                        ],
                    }
                ),
            )

        self.assertEqual(fake_supabase.update_calls[0][0], "profiles")
        self.assertEqual(
            fake_supabase.update_calls[0][1]["admin_review_moderation_preferences"],
            {
                "preset": "escalated_only",
                "status": "all",
                "assignee": "unassigned",
                "priority": "escalated",
                "activity_log": [
                    {
                        "id": "entry-1",
                        "kind": "watchlist",
                        "label": "Opened escalated watchlist",
                    }
                ],
            },
        )
        self.assertEqual(
            result.admin_review_moderation_preferences,
            {
                "preset": "escalated_only",
                "status": "all",
                "assignee": "unassigned",
                "priority": "escalated",
                "activity_log": [
                    {
                        "id": "entry-1",
                        "kind": "watchlist",
                        "label": "Opened escalated watchlist",
                    }
                ],
            },
        )

    def test_update_profile_persists_admin_transaction_support_preferences(self):
        fake_supabase = _FakeSupabase()
        current_user = CurrentUser(id="user-1", access_token="token-1")

        with patch("app.services.profiles.get_supabase_client", return_value=fake_supabase):
            result = update_my_profile(
                current_user,
                ProfileUpdate(
                    admin_transaction_support_preferences={
                        "preset": "trust_queue",
                        "type": "booking",
                        "status": "open",
                        "assignee": "mine",
                        "priority": "escalated",
                        "role": "trust",
                        "delivery": "failed",
                        "trust": "trust_driven",
                        "listing": "listing-1",
                        "listingHealth": "trust_flagged",
                        "q": "seller dispute",
                        "focus": "booking:booking-1",
                    }
                ),
            )

        self.assertEqual(fake_supabase.update_calls[0][0], "profiles")
        self.assertEqual(
            fake_supabase.update_calls[0][1]["admin_transaction_support_preferences"],
            {
                "preset": "trust_queue",
                "type": "booking",
                "status": "open",
                "assignee": "mine",
                "priority": "escalated",
                "role": "trust",
                "delivery": "failed",
                "trust": "trust_driven",
                "listing": "listing-1",
                "listingHealth": "trust_flagged",
                "q": "seller dispute",
                "focus": "booking:booking-1",
            },
        )
        self.assertEqual(
            result.admin_transaction_support_preferences,
            {
                "preset": "trust_queue",
                "type": "booking",
                "status": "open",
                "assignee": "mine",
                "priority": "escalated",
                "role": "trust",
                "delivery": "failed",
                "trust": "trust_driven",
                "listing": "listing-1",
                "listingHealth": "trust_flagged",
                "q": "seller dispute",
                "focus": "booking:booking-1",
            },
        )


if __name__ == "__main__":
    unittest.main()
