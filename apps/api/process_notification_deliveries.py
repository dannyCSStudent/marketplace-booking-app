from app.services.notification_delivery_worker import process_notification_deliveries


if __name__ == "__main__":
    result = process_notification_deliveries()
    print(result)
