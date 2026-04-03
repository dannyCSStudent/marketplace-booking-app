# API

FastAPI backend for the marketplace and booking app.

## Local setup

1. Create and activate a virtual environment in `apps/api/.venv`
2. Install dependencies from `pyproject.toml`
3. Configure `apps/api/.env`

## Scripts

- `pnpm --filter api dev`: run the API locally
- `pnpm --filter api lint`: compile Python sources to catch syntax errors
- `pnpm --filter api test`: run service-level regression tests
- `pnpm --filter api seed`: seed demo users and marketplace data into Supabase
- `pnpm --filter api notifications:process`: process one batch of queued notification deliveries
- `pnpm --filter api notifications:queue-test --email you@example.com --channel email|push`: queue a direct smoke-test delivery
- `pnpm --filter api notifications:prune`: delete old sent/failed delivery rows based on retention settings
- `pnpm --filter api notifications:requeue`: requeue failed notification deliveries for another attempt
- `pnpm --filter api notifications:maintenance`: run the notification maintenance loop continuously
- `pnpm --filter api notifications:worker`: run the notification worker loop continuously

## Notification Worker

The outbound delivery path now has two modes:

- One-shot batch: `pnpm --filter api notifications:process`
- Long-running worker: `pnpm --filter api notifications:worker`

Relevant env vars in `apps/api/.env`:

- `NOTIFICATION_EMAIL_PROVIDER=log|webhook|resend`
- `NOTIFICATION_PUSH_PROVIDER=log|webhook|expo`
- `EXPO_ACCESS_TOKEN=...` optional for authenticated Expo push sends
- `NOTIFICATION_FROM_EMAIL=...`
- `RESEND_API_KEY=...`
- `NOTIFICATION_MAX_ATTEMPTS=3`
- `NOTIFICATION_WORKER_POLL_SECONDS=30`
- `NOTIFICATION_WORKER_BATCH_SIZE=25`

Recommended production shape:

1. Run the FastAPI API as one process.
2. Run `pnpm --filter api notifications:worker` as a separate process.
3. Point both at the same `apps/api/.env` values.

## Push Smoke Test

1. Start the mobile app on a real device.
2. Sign in as the buyer and press `Sync Push`.
3. Confirm `profiles.expo_push_token` is populated.
4. Queue and process a direct push test:

```sh
pnpm --filter api notifications:queue-test --email you@example.com --channel push
pnpm --filter api notifications:process
```
