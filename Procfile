api: cd apps/api && ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
notification-worker: cd apps/api && ./.venv/bin/python run_notification_worker.py
