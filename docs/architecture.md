# Architecture

## Overview

This repository is a full-stack monorepo for a local marketplace + booking platform.

The stack is:

- **Expo** for mobile
- **Next.js** for web
- **FastAPI** for backend business logic
- **Supabase** for auth, database, storage, and realtime
- **pnpm workspaces** + **Turborepo** for monorepo orchestration

The architecture is designed to be production-shaped early while still allowing fast iteration.

---

## High-Level System Design

### Mobile App
The Expo app provides:
- buyer flows
- seller quick actions
- onboarding
- browsing
- listing detail
- order and booking actions

### Web App
The Next.js app provides:
- seller dashboard workflows
- management-heavy screens
- web browsing experience
- future admin or ops interfaces

### FastAPI API
The FastAPI service provides:
- domain orchestration
- secure business logic
- order creation rules
- booking creation rules
- future payment orchestration
- future notifications/webhooks/AI logic

### Supabase
Supabase provides:
- authentication
- relational Postgres database
- storage
- row-level security
- realtime features when needed

---

## Repository Layout

```txt
apps/
  api/
  mobile/
  web/

packages/
  ui/
  types/
  config/
  supabase/

infra/
  supabase/
    migrations/
    seeds/

docs/
  roadmap.md
  product.md
  architecture.md