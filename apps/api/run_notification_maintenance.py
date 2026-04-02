import json
import time

from app.core.config import get_settings
from app.services.notification_delivery_maintenance import prune_notification_deliveries
from app.services.notification_delivery_worker import process_notification_deliveries

def main() -> None:
    settings = get_settings()
    poll_seconds = settings.notification_maintenance_poll_seconds

    result = process_notification_deliveries()
    print(result)

    print(
        json.dumps(
            {
                "worker": "notification_maintenance",
                "poll_seconds": poll_seconds,
                "sent_retention_days": settings.notification_sent_retention_days,
                "failed_retention_days": settings.notification_failed_retention_days,
            }
        )
    )

    while True:
        result = prune_notification_deliveries()
        print(json.dumps({"type": "notification_maintenance_pruned", **result}))
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
    
