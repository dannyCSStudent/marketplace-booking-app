COMPOSE ?= docker compose
TARGET_EMAIL ?= newtondanny49@gmail.com

.PHONY: up deps frontend backend down restart logs frontend-logs api-logs worker-logs web-logs mobile-logs \
	ps build api-shell web-shell mobile-shell api-health \
	notifications-process notifications-worker notifications-queue-test notifications-test-email \
	notifications-requeue notifications-prune maintenance-logs notifications-maintenance

up:
	$(COMPOSE) up --build

deps:
	$(COMPOSE) up --build frontend-deps

frontend:
	$(COMPOSE) up --build web mobile

backend:
	$(COMPOSE) up --build api notification-worker notification-maintenance

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) down
	$(COMPOSE) up --build

logs:
	$(COMPOSE) logs -f

frontend-logs:
	$(COMPOSE) logs -f web mobile

api-logs:
	$(COMPOSE) logs -f api

worker-logs:
	$(COMPOSE) logs -f notification-worker

web-logs:
	$(COMPOSE) logs -f web

mobile-logs:
	$(COMPOSE) logs -f mobile

maintenance-logs:
	$(COMPOSE) logs -f notification-maintenance

ps:
	$(COMPOSE) ps

build:
	$(COMPOSE) build

api-shell:
	$(COMPOSE) exec api /bin/sh

web-shell:
	$(COMPOSE) exec web /bin/sh

mobile-shell:
	$(COMPOSE) exec mobile /bin/sh

api-health:
	curl http://127.0.0.1:8000/health

notifications-process:
	$(COMPOSE) exec api python process_notification_deliveries.py

notifications-worker:
	$(COMPOSE) exec notification-worker python run_notification_worker.py

notifications-queue-test:
	$(COMPOSE) exec api python queue_test_notification.py --email $(TARGET_EMAIL) --channel email

notifications-test-email:
	$(COMPOSE) exec api python queue_test_notification.py --email $(TARGET_EMAIL) --channel email
	$(COMPOSE) exec api python process_notification_deliveries.py

notifications-requeue:
	$(COMPOSE) exec api python requeue_notification_deliveries.py --status failed --channel email

notifications-prune:
	$(COMPOSE) exec api python prune_notification_deliveries.py

notifications-maintenance:
	$(COMPOSE) exec notification-maintenance python run_notification_maintenance.py
