import argparse

from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client


def main() -> None:
    parser = argparse.ArgumentParser(description="Queue a test notification delivery.")
    parser.add_argument("--email", required=True, help="Email address of an existing auth user.")
    parser.add_argument(
        "--channel",
        default="email",
        choices=["email", "push"],
        help="Notification channel to queue.",
    )
    args = parser.parse_args()

    supabase = get_supabase_client()
    user = _find_auth_user_by_email(supabase, args.email)
    if not user:
        raise SystemExit(f"No auth user found for {args.email}")

    rows = supabase.insert(
        "notification_deliveries",
        {
            "recipient_user_id": user["id"],
            "transaction_kind": "order",
            "transaction_id": "00000000-0000-0000-0000-000000000001",
            "event_id": "00000000-0000-0000-0000-000000000001",
            "channel": args.channel,
            "delivery_status": "queued",
            "payload": {
                "to": args.email,
                "subject": "Marketplace notification test",
                "html": "<p>Your outbound notification worker is connected.</p>",
                "status": "test",
                "transaction_kind": "order",
                "transaction_id": "test",
                "actor_role": "system",
                "note": "This is a test notification.",
            },
        },
        use_service_role=True,
    )
    print({"queued": len(rows), "delivery_id": rows[0]["id"], "email": args.email, "channel": args.channel})


def _find_auth_user_by_email(supabase, email: str) -> dict | None:
    try:
        users = supabase.list_auth_users()
    except SupabaseError as exc:
        raise SystemExit(f"Unable to list auth users: {exc.detail}") from exc

    for user in users:
        if user.get("email") == email:
            return user

    return None


if __name__ == "__main__":
    main()
