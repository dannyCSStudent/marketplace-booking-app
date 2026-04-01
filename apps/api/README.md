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
