# Deployment

This repo now has two backend runtime processes:

- `api`: serves the FastAPI app
- `notification-worker`: continuously processes queued notification deliveries

## Docker Compose

The repo root now includes [compose.yaml](/home/dee/Documents/Demos/marketplace-booking-app/compose.yaml) and a reusable API image in [Dockerfile](/home/dee/Documents/Demos/marketplace-booking-app/apps/api/Dockerfile).

Services:

- `api`: FastAPI on port `8000`
- `web`: Next.js dev server on port `3000`
- `mobile`: Expo dev server on ports `8081`, `19000`, and `19001`
- `notification-worker`: long-running outbound delivery worker
- `notification-maintenance`: long-running retention cleanup loop

Start both:

```sh
docker compose up --build
```

Or with the repo [Makefile](/home/dee/Documents/Demos/marketplace-booking-app/Makefile):

```sh
make up
```

Common split modes:

```sh
make backend
make frontend
```

Or from the repo root with pnpm:

```sh
pnpm dev:docker
pnpm dev:frontend
```

Frontend notes:

- `web` is configured with `INTERNAL_API_BASE_URL=http://api:8000` for server-side fetches inside the container.
- `web` still exposes `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` so the browser can reach the API through the host port.
- `mobile` runs Expo inside Docker for a containerized local dev loop. If the emulator/device has trouble resolving the Metro server from Docker, check the `mobile` logs first and fall back to running `pnpm --filter mobile dev` on the host.

Run only the worker:

```sh
docker compose up --build notification-worker
```

Run only the API:

```sh
docker compose up --build api
```

## Useful Make Targets

```sh
make up
make down
make ps
make api-health
make api-logs
make web-logs
make mobile-logs
make worker-logs
make maintenance-logs
make notifications-test-email TARGET_EMAIL=you@example.com
make notifications-requeue
make notifications-prune
```

## Required Backend Env

At minimum, the worker/API need:

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_SCHEMA=public
NOTIFICATION_EMAIL_PROVIDER=resend
NOTIFICATION_PUSH_PROVIDER=log
RESEND_API_KEY=...
NOTIFICATION_FROM_EMAIL=Your Name <your-verified-sender@yourdomain.com>
NOTIFICATION_MAX_ATTEMPTS=3
NOTIFICATION_WORKER_POLL_SECONDS=30
NOTIFICATION_WORKER_BATCH_SIZE=25
NOTIFICATION_MAINTENANCE_POLL_SECONDS=21600
```

## Recommended Shape

1. Run `api` as one service/process.
2. Run `notification-worker` as a separate worker/background process.
3. Run `notification-maintenance` as a separate cleanup/background process.
4. Point all three at the same backend env vars.
5. Apply all Supabase migrations before first deploy.

## Procfile

The repo root also includes [Procfile](/home/dee/Documents/Demos/marketplace-booking-app/Procfile) for Procfile-style hosts.

## Platform Mapping

- Docker/Compose:
  Use the included `compose.yaml`.
- Kubernetes:
  Reuse the same API image with different commands for API and worker.
- Railway/Render/Fly/Heroku-style hosts:
  Use the `Procfile` process split.
- VM/systemd:
  Create two units, one for uvicorn and one for `run_notification_worker.py`.

## Smoke Checks

After deploy:

1. Hit the API health endpoint.
2. Queue a test notification:
   `pnpm --filter api notifications:queue-test --email you@example.com --channel email`
3. Confirm the worker marks the delivery `sent` in `notification_deliveries`.
