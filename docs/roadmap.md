# Roadmap

## Overview

This roadmap outlines the phased development of the local marketplace + booking platform.

The goal is to move from a strong MVP to a differentiated, production-ready product with real-world usability.

The roadmap is organized into phases:

1. Foundation
2. MVP (Core Commerce)
3. Trust & Operations
4. Differentiation
5. Monetization
6. Scale & Intelligence

Each phase builds on the previous one.

## Current Status

The product is past the MVP stage and now has real depth in trust/ops, monetization, and buyer/seller workflow memory.

- Phase 0: complete
- Phase 1: complete
- Phase 2: mostly complete
- Phase 3: mostly complete
- Phase 4: mostly complete
- Phase 5: in progress
- Phase 6: not yet started in earnest

The biggest remaining work is scale hardening, backend reliability, and advanced intelligence.

---

## Phase 0 — Foundation (Week 1 Start)

### Goal
Establish a production-shaped foundation for fast and safe development.

### Includes
- Monorepo structure (Expo, Next.js, FastAPI)
- Supabase integration
- Environment setup
- Shared types package
- Initial database schema
- AGENTS.md and docs
- Basic API structure
- Seed data

### Deliverables
- `pnpm dev` runs all apps
- FastAPI health endpoint
- Supabase connected
- Initial migration applied
- Docs reflect architecture

---

## Phase 1 — MVP: Core Commerce (Week 1)

### Goal
Deliver a full vertical slice where real transactions can happen.

### Core Capabilities

#### Auth & Profiles
- Sign up / sign in (web + mobile)
- Profile bootstrap
- Profile editing

#### Seller Onboarding
- Create seller profile
- Seller dashboard shell

#### Listings
- Create listing (product or service)
- Edit listing
- View own listings
- Categories support

#### Discovery
- Public listing feed
- Basic search
- Category filtering
- Listing detail page

#### Orders (Products)
- Create order request
- Seller views orders
- Buyer views orders
- Status updates

#### Bookings (Services)
- Create booking request
- Seller confirms/declines
- Buyer views bookings
- Status updates

### Success Criteria
- A user can sign up and become a seller
- A seller can create listings
- A buyer can browse listings
- A buyer can place an order or booking
- A seller can manage requests

### Status
- Complete. The core commerce slice exists across web, mobile, and backend flows.

---

## Phase 2 — Trust & Operations (Week 2–3)

### Goal
Make the platform feel reliable, structured, and safer.

### Features

#### Reviews & Ratings
- Buyer leaves review after order/booking
- Seller rating aggregation
- Review display on seller profile

#### Order & Booking Lifecycle
- Expanded status tracking
- Timeline/history of events
- Cancellation support

#### Fulfillment Improvements
- Pickup instructions
- Delivery notes
- Address management

#### Seller Tools
- Basic analytics (orders count, revenue estimate)
- Listing status (active, paused, sold out)

#### Notifications (Basic)
- Order received
- Booking request received
- Status changes

### Success Criteria
- Users can trust sellers based on reviews
- Sellers can manage operations without confusion
- Orders and bookings feel structured

### Status
- Mostly complete. Reviews, lifecycle/history, fulfillment context, seller tools, and notifications are in place.

---

## Phase 3 — Differentiation (Week 3–5)

### Goal
Make the product meaningfully better than generic marketplaces.

### Features

#### AI Listing Assistant
- Generate title and description from image/text
- Improve listing clarity
- Suggest tags/categories

#### Pricing Intelligence
- Suggested price ranges
- Basic demand insights
Status: in progress. Seller workspace pricing insights and listing traction signals are live.
    - Added comparison-scope history so sellers know exactly which sample tier (category/local/type) backed their price changes.

#### Local Feed Enhancements
- “Available today” listings
- “Popular near you”
- “New listings”
Status: live across buyer web, buyer mobile, listing detail, seller workspace, and admin ops panels.

#### Seller Insights
- Repeat customers
- Listing performance
- Conversion hints
Status: in progress. Seller workspace and admin ops now surface listing retention, adjustment summaries, and recent demand pills.

#### Smart Discovery
- Better search ranking
- Category refinement
- Location-aware feed improvements

### Success Criteria
- Sellers can create better listings faster
- Buyers discover relevant listings quickly
- The app feels intelligent and helpful

### Status
- Mostly complete. Local-first discovery, pricing intelligence, seller insights, and stronger ranking flows are live.

---

## Phase 4 — Monetization (Week 5+)

### Goal
Introduce sustainable revenue streams.

### Features

#### Platform Fees
- Percentage per transaction
- Configurable fee model

#### Promoted Listings
- Boost listings in feed
- Featured placement

#### Seller Subscriptions
- Premium tools
- Analytics upgrades
- Priority visibility

#### Delivery Fees
- Optional integration
- Seller or platform controlled

### Success Criteria
- Revenue is generated without harming UX
- Sellers see value in paid features

### Status
- Mostly complete. Platform fees, promoted listings, subscriptions, and delivery-fee workflows are surfaced in product and admin views.

---

## Phase 5 — Scale & Infrastructure

### Goal
Ensure the system can handle growth and complexity.

### Features

#### Performance
- Query optimization
- Caching strategies
- Pagination everywhere

#### Reliability
- Error handling improvements
- Logging and monitoring
- Retry strategies for critical flows

#### Background Jobs
- Notifications
- Email/SMS
- Scheduled tasks

#### Security Enhancements
- Stronger validation
- Rate limiting
- Abuse detection

### Status
- In progress. Reliability and operational visibility are better, but performance hardening, pagination, caching, and broader abuse controls still need work.

---

## Phase 6 — Advanced Intelligence

### Goal
Turn the platform into a smart commerce engine.

### Features

#### Trust Score System
- Delivery reliability
- Response time
- Review quality
- Dispute history

#### Fraud Detection
- Suspicious behavior flags
- Automated alerts

#### AI Operations
- Auto-reply suggestions
- Smart scheduling suggestions
- Demand forecasting

#### Seller Automation
- Auto-accept bookings (rules-based)
- Inventory alerts
- Pricing adjustments

### Status
- Not yet started in earnest. This is the next major product differentiation layer after scale work stabilizes.

---

## Milestones Summary

### Milestone 1
- Auth, profiles, sellers
- Listings working
- Basic feed

### Milestone 2
- Orders and bookings working
- Seller dashboard usable

### Milestone 3
- Reviews and trust added
- Fulfillment improved

### Milestone 4
- AI features begin
- Discovery improves

### Milestone 5
- Monetization added

---

## What Not To Build Early

Avoid these until after MVP:

- Complex payment systems
- Advanced calendar scheduling
- Chat/messaging systems
- Map-based delivery routing
- Overbuilt analytics dashboards
- Over-engineered abstractions

Focus on working flows first.

---

## Development Strategy

### Build Order Priority
1. Auth
2. Profiles
3. Sellers
4. Listings
5. Feed
6. Orders
7. Bookings
8. Trust
9. AI
10. Monetization

### Execution Style
- Build vertical slices, not isolated features
- Keep changes scoped
- Commit frequently
- Update docs as you go

---

## North Star

Build the best platform for local sellers and service providers to:

- sell
- book
- operate
- grow

The product should feel:

- simple
- fast
- trustworthy
- local
- powerful
