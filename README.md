# Marketplace Booking App

Marketplace and service-booking monorepo built with:

- Expo for mobile
- Next.js for web
- FastAPI for backend business logic
- Supabase for auth, database, storage, and realtime
- pnpm workspaces + Turborepo

## Apps

- `apps/api`: FastAPI backend
- `apps/mobile`: Expo buyer app
- `apps/web`: Next.js seller workspace

## Core Scripts

```sh
pnpm dev
pnpm dev:docker
pnpm dev:frontend
pnpm dev:web
pnpm dev:mobile
pnpm lint
pnpm test
pnpm --filter web build
pnpm --filter api seed
```

Use the scripts like this:

- `pnpm dev`: all-local mode. Starts API, web, and mobile on the host.
- `pnpm dev:docker`: Docker/Compose mode. Starts API, web, mobile, worker, and maintenance in containers.
- `pnpm dev:frontend`: frontend-only host mode. Use this when Docker already owns the backend.
- `pnpm dev:web`: only the Next.js app on the host.
- `pnpm dev:mobile`: only the Expo app on the host.

## Mobile Push Testing

Expo Go is fine for general UI work, but it cannot register remote push tokens. Push testing requires a development build on a real device.

Android push also requires Firebase Cloud Messaging credentials even if you are not using the Firebase JS SDK directly. Expo push notifications on Android sit on top of FCM, so the native Android app still needs `google-services.json`.

Typical flow:

```sh
make backend
pnpm --filter mobile android:dev-client
pnpm --filter mobile dev-client
```

Or on iOS:

```sh
make backend
pnpm --filter mobile ios:dev-client
pnpm --filter mobile dev-client
```

Notes:

- `pnpm --filter mobile dev` starts Expo Go style development.
- `pnpm --filter mobile dev-client` starts Metro for a development build.
- `pnpm --filter mobile android:dev-client` and `ios:dev-client` create/install the native dev build locally.
- Remote push registration requires a real physical device, notification permission, and `EXPO_PUBLIC_EAS_PROJECT_ID`.
- For Android push, create a Firebase Android app with package name `com.alacartes_dee.mobile`, download `google-services.json`, and place it at [apps/mobile/google-services.json](/home/dee/Documents/Demos/marketplace-booking-app/apps/mobile/google-services.json). Then rebuild the dev client.
- For iOS push later, place `GoogleService-Info.plist` at [apps/mobile/GoogleService-Info.plist](/home/dee/Documents/Demos/marketplace-booking-app/apps/mobile/GoogleService-Info.plist).

## Notification Delivery

The backend now has two runtime processes:

- `api`: serves FastAPI
- `notification-worker`: continuously processes queued notification deliveries

One-shot processing:

```sh
pnpm --filter api notifications:process
```

Long-running worker:

```sh
pnpm --filter api notifications:worker
```

Queue a test delivery:

```sh
pnpm --filter api notifications:queue-test --email you@example.com --channel email
```

## Deployment

The repo root includes a [Procfile](/home/dee/Documents/Demos/marketplace-booking-app/Procfile) with separate `api` and `notification-worker` processes.

If you use Docker/Compose, the repo also includes:

- [compose.yaml](/home/dee/Documents/Demos/marketplace-booking-app/compose.yaml)
- [Dockerfile](/home/dee/Documents/Demos/marketplace-booking-app/apps/api/Dockerfile)
- [Makefile](/home/dee/Documents/Demos/marketplace-booking-app/Makefile)

Common Docker workflow:

```sh
make deps
make up
make frontend
make backend
make api-health
make web-logs
make mobile-logs
make frontend-logs
make notifications-test-email TARGET_EMAIL=you@example.com
make notifications-test-push TARGET_EMAIL=you@example.com
make worker-logs
```

When Docker Compose is running, it now starts:

- `api` on `http://127.0.0.1:8000`
- `web` on `http://127.0.0.1:3000`
- `mobile` Expo dev server on `8081`, `19000`, and `19001`
- `notification-worker`
- `notification-maintenance`

The `web` container uses plain `next dev` in Compose instead of Turbopack. That is intentional: Turbopack was unstable in the containerized dev loop even though the app code itself was fine.

Compose now installs frontend workspace dependencies through a one-shot `frontend-deps` service before `web` and `mobile` start. That avoids both frontend containers running `pnpm install` at the same time against the same mounted workspace, which can trigger noisy rebuilds and apparent refresh loops.

The web container also keeps `.next` on an isolated Docker volume instead of writing it back into the repo mount. That reduces self-triggered rebuild loops in containerized Next development.

Do not run root `pnpm dev` at the same time as Compose unless you intentionally want duplicate local processes. If Compose already owns the API on port `8000`, use:

```sh
pnpm dev:frontend
```

only when you are running frontend apps outside Docker. For one-off host runs, `pnpm dev:web` and `pnpm dev:mobile` are the direct equivalents.

See [deployment.md](/home/dee/Documents/Demos/marketplace-booking-app/docs/deployment.md) for:

- required env vars
- worker runtime configuration
- Procfile-based deployment shape
- post-deploy smoke checks
