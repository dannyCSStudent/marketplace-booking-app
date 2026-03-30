# AGENTS.md

This document defines how AI coding agents should operate in this repository.

The repository is a production-shaped full-stack monorepo built with:

- Expo for mobile
- Next.js for web
- FastAPI for backend business logic
- Supabase for auth, database, storage, and realtime
- pnpm workspaces + Turborepo for monorepo management

The current product is a marketplace + booking platform for local sellers and service providers.

---

## 1. Mission

Build a high-quality local commerce platform where users can:

- sell products
- offer services
- accept bookings
- manage orders
- choose fulfillment methods
- build trust and repeat customers

This is not a generic marketplace clone.

It is a local commerce operating system for small businesses, hustlers, independent workers, and community sellers.

Examples include:

- tamales
- baked goods
- candy
- catering
- welding
- beauty services
- home services
- tutoring
- photography
- repairs
- handmade goods

---

## 2. Product Principles

All work in this repository should follow these principles:

1. **Mobile-first**
   - The app must feel natural on mobile first.
   - Web is important, but mobile should remain the primary buyer/seller experience.

2. **Local-first**
   - Features should support local commerce and practical real-world selling.
   - Pickup, meetup, delivery, and service booking matter from the start.

3. **Simple beats clever**
   - Prefer direct, readable code over abstract or overly clever code.
   - Favor explicitness over hidden magic.

4. **Secure by default**
   - Use safe ownership rules.
   - Exposed tables must use Row Level Security.
   - Privileged operations belong in secure server contexts.

5. **Production-shaped from day one**
   - Even if the feature set is small, the architecture should be scalable.
   - Avoid choices that force major rewrites later.

6. **Thin UI, strong domain logic**
   - UI should render and coordinate.
   - Business rules should live in services or server-side logic.

---

## 3. Repository Structure

Target repository structure:

```txt
apps/
  api/        # FastAPI backend
  mobile/     # Expo app
  web/        # Next.js app

packages/
  ui/         # shared UI components
  types/      # shared domain types
  config/     # shared config packages if added later
  supabase/   # shared Supabase helpers if added later

infra/
  supabase/
    migrations/
    seeds/

docs/
  roadmap.md
  product.md
  architecture.md