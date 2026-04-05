FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY apps/api/pyproject.toml ./pyproject.toml
COPY apps/api/README.md ./README.md
COPY apps/api/app ./app
COPY apps/api/export_openapi.py ./export_openapi.py
COPY apps/api/check_openapi.py ./check_openapi.py
COPY apps/api/generate_openapi_types.py ./generate_openapi_types.py
COPY apps/api/process_notification_deliveries.py ./process_notification_deliveries.py
COPY apps/api/queue_test_notification.py ./queue_test_notification.py
COPY apps/api/queue_transaction_notification_test.py ./queue_transaction_notification_test.py
COPY apps/api/prune_notification_deliveries.py ./prune_notification_deliveries.py
COPY apps/api/requeue_notification_deliveries.py ./requeue_notification_deliveries.py
COPY apps/api/run_notification_maintenance.py ./run_notification_maintenance.py
COPY apps/api/run_notification_worker.py ./run_notification_worker.py
COPY apps/api/seed.py ./seed.py

RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
