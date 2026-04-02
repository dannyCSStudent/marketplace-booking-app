import argparse
from datetime import datetime, timezone

from app.dependencies.supabase import get_supabase_client


def main() -> None:
    parser = argparse.ArgumentParser(description="Requeue failed notification deliveries.")
    parser.add_argument(
        "--status",
        default="failed",
        choices=["failed", "queued", "processing", "sent", "skipped"],
        help="Current delivery status to target.",
    )
    parser.add_argument(
        "--channel",
        choices=["email", "push"],
        help="Optional channel filter.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Maximum number of deliveries to requeue.",
    )
    args = parser.parse_args()

    supabase = get_supabase_client()
    query = {
        "select": "id",
        "delivery_status": f"eq.{args.status}",
        "order": "created_at.desc",
        "limit": str(args.limit),
    }
    if args.channel:
        query["channel"] = f"eq.{args.channel}"

    rows = supabase.select(
        "notification_deliveries",
        query=query,
        use_service_role=True,
    )
    delivery_ids = [row["id"] for row in rows]

    if not delivery_ids:
        print({"requeued": 0, "status": args.status, "channel": args.channel})
        return

    id_filter = ",".join(delivery_ids)
    updated = supabase.update(
        "notification_deliveries",
        {
            "delivery_status": "queued",
            "failure_reason": None,
            "next_attempt_at": datetime.now(timezone.utc).isoformat(),
        },
        query={
            "id": f"in.({id_filter})",
            "select": "id",
        },
        use_service_role=True,
    )
    print(
        {
            "requeued": len(updated),
            "status": args.status,
            "channel": args.channel,
            "ids": [row["id"] for row in updated],
        }
    )


if __name__ == "__main__":
    main()
