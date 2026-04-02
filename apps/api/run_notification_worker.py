import time

from app.core.config import get_settings
from app.services.notification_delivery_worker import process_notification_deliveries


def main() -> None:
    settings = get_settings()
    poll_seconds = settings.notification_worker_poll_seconds
    batch_size = settings.notification_worker_batch_size

    print(
        {
            "worker": "notification_delivery",
            "poll_seconds": poll_seconds,
            "batch_size": batch_size,
        }
    )

    while True:
        result = process_notification_deliveries(batch_size=batch_size)
        print(result)
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
