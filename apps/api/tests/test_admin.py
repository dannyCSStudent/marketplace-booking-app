import unittest
from unittest.mock import patch

from app.schemas.admin import AdminUserRead
from app.services.admin import list_admin_users


class AdminUserTests(unittest.TestCase):
    def test_lists_allowlisted_admins_with_emails(self):
        class _Settings:
            admin_user_ids = ("admin-2", "admin-1")
            admin_user_roles = {"admin-1": "Owner", "admin-2": "Support"}

        class _Supabase:
            def list_auth_users(self):
                return [
                    {"id": "admin-1", "email": "alpha@example.com"},
                    {"id": "admin-2", "email": "zeta@example.com"},
                    {"id": "user-3", "email": "other@example.com"},
                ]

            def select(self, *_args, **_kwargs):
                return [
                    {"id": "admin-1", "full_name": "Alpha Admin", "username": "alpha"},
                    {"id": "admin-2", "full_name": "Zeta Admin", "username": "zeta"},
                ]

        with patch("app.services.admin.get_settings", return_value=_Settings()):
            with patch("app.services.admin.get_supabase_client", return_value=_Supabase()):
                admins = list_admin_users()

        self.assertEqual(
            admins,
            [
                AdminUserRead(
                    id="admin-1",
                    full_name="Alpha Admin",
                    username="alpha",
                    email="alpha@example.com",
                    role="Owner",
                ),
                AdminUserRead(
                    id="admin-2",
                    full_name="Zeta Admin",
                    username="zeta",
                    email="zeta@example.com",
                    role="Support",
                ),
            ],
        )

    def test_keeps_allowlisted_admin_without_email_match(self):
        class _Settings:
            admin_user_ids = ("admin-1",)
            admin_user_roles = {}

        class _Supabase:
            def list_auth_users(self):
                return []

            def select(self, *_args, **_kwargs):
                return []

        with patch("app.services.admin.get_settings", return_value=_Settings()):
            with patch("app.services.admin.get_supabase_client", return_value=_Supabase()):
                admins = list_admin_users()

        self.assertEqual(
            admins,
            [AdminUserRead(id="admin-1", full_name=None, username=None, email=None, role=None)],
        )


if __name__ == "__main__":
    unittest.main()
