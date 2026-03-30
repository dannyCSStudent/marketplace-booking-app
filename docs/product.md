
---

### `docs/product.md`

```md
# Product

## Overview

This product is a local marketplace + booking platform for independent sellers and service providers.

It is designed for people who need a practical way to:

- sell products
- offer services
- accept orders
- accept booking requests
- manage local fulfillment
- grow trust and repeat customers

The platform should work for both physical goods and time-based services in the same ecosystem.

This is a local commerce app, not just a generic marketplace.

---

## Core Problem

Small sellers and local service providers often have to piece together multiple tools:

- one place to promote themselves
- another place to accept orders
- another place to schedule appointments
- manual DMs or phone calls to coordinate pickup or delivery
- no consistent trust or seller profile system

That creates friction for both buyers and sellers.

Buyers want a fast and trustworthy way to discover, order, and book locally.

Sellers want a simple system that helps them run their business without needing five different apps.

---

## Product Vision

Build the operating system for local commerce.

A user should be able to open the app and quickly:

- browse local listings
- place an order for a product
- request a booking for a service
- discover trusted sellers
- choose how to receive the product or service

A seller should be able to:

- create a seller profile
- create product listings
- create service listings
- manage incoming orders
- manage booking requests
- choose fulfillment methods
- build a trusted storefront over time

---

## Target Users

### Buyers
People who want to:
- order food from local sellers
- buy handmade or specialty products
- discover local providers
- request services
- support neighborhood businesses

### Sellers
Independent people or microbusinesses who sell:
- food
- baked goods
- candy and treats
- catering
- handmade goods
- custom items

### Service Providers
People who offer:
- welding
- repairs
- beauty services
- tutoring
- photography
- event services
- home services
- auto services

---

## Product Positioning

This app combines:

- marketplace
- booking
- seller storefront
- local fulfillment
- trust and reputation

The product is stronger than a simple marketplace because it supports both:

1. product commerce
2. service commerce

That means a seller could use it to:
- sell tamales by the dozen
- take custom cake orders
- offer welding repair appointments
- accept meetup or pickup requests
- deliver locally
- later build a reputation and repeat customer base

---

## Core Concepts

### User Profile
A basic user identity for any signed-in person.

### Seller Profile
A public-facing seller identity tied to a user profile.

This includes:
- display name
- slug
- bio
- location
- custom-order support
- later verification and trust signals

### Listing
A seller-owned offering.

Listings can be:

- `product`
- `service`
- `hybrid`

#### Product examples
- tamales
- cookies
- candy bags
- custom metal signs

#### Service examples
- welding repair
- haircut
- tutoring session
- photography session

#### Hybrid examples
- custom cake order with pickup scheduling
- custom fabrication job with appointment
- event catering with scheduling

### Order
Used when a buyer requests to purchase a product listing.

### Booking
Used when a buyer requests time with a service listing.

### Fulfillment
How a product is received or how service coordination happens.

Initial methods:
- pickup
- meetup
- delivery
- shipping

---

## Roles

### Buyer
A signed-in user who browses, orders, or books.

### Seller
A signed-in user who has completed seller onboarding and can publish listings.

A user can be:
- buyer only
- seller only
- both buyer and seller

---

## Week 1 MVP

The Week 1 MVP is a vertical slice focused on proving the core concept.

### Goals
A user can:
- sign up
- sign in
- create a profile
- become a seller
- create a listing
- browse listings
- view listing details
- place an order request for a product
- request a booking for a service

A seller can:
- create a seller profile
- create product listings
- create service listings
- see their listings
- see incoming orders
- see incoming bookings
- update order/booking status

### Week 1 Scope
Included:
- auth
- profiles
- seller profiles
- categories
- listings
- listing detail
- basic search/filter
- order request flow
- booking request flow
- seller dashboard shell

Not included yet:
- real payments
- advanced availability scheduling
- chat
- notifications
- reviews
- favorites
- AI listing assistant
- analytics
- map/delivery routing

---

## Initial Listing Types

### Product
Used for straightforward purchases.

Key behavior:
- quantity-based ordering
- fulfillment methods apply
- usually no booking required

### Service
Used for time-based offerings.

Key behavior:
- booking request flow
- scheduled start and end
- seller confirms or declines

### Hybrid
Used for offerings that combine product and scheduling behavior.

Key behavior:
- may require both order-like and booking-like logic later
- supported in the data model early even if week 1 uses mostly product or service behavior

---

## Initial Fulfillment Modes

The first version should support:

### Pickup
Buyer picks up from seller.

### Meetup
Buyer and seller meet at an agreed place.

### Delivery
Seller or a local delivery method brings the item to the buyer.

### Shipping
Seller ships the item.

Not every listing must support every fulfillment method.

---

## Why This Product Can Be Strong

Most local commerce tools are fragmented.

This product becomes stronger by combining:
- discovery
- ordering
- booking
- fulfillment options
- seller identity
- future trust/reputation

That creates a better experience than:
- only using DMs
- only using appointment tools
- only using generic marketplace apps
- only using link-in-bio style selling tools

---

## Future Differentiators

After the MVP works, the product can become much stronger with:

### Trust and Reputation
- reviews
- verification
- trust score inputs
- order/booking history signals

### Operational Tools
- seller dashboard improvements
- inventory basics
- booking windows
- cancellation policies
- customer history

### AI Features
- AI-assisted listing creation
- pricing suggestions
- listing rewrite/improvement
- local demand suggestions
- seller insights

### Monetization
- platform fee
- promoted listings
- seller subscriptions
- premium storefront features

---

## MVP Success Criteria

The MVP is successful when:

- onboarding is simple
- seller creation is easy
- listing creation works for both product and service cases
- buyers can browse and act
- order requests work
- booking requests work
- seller views are usable
- the product feels real enough to demo confidently

---

## Product Design Direction

The product should feel:

- modern
- premium
- trustworthy
- local
- simple
- fast

### Mobile UX priorities
- fast browsing
- large cards
- clear CTAs
- quick listing creation
- clean seller actions

### Web UX priorities
- seller dashboard clarity
- straightforward management
- clean forms
- readable overview screens

---

## Product North Star

Build the best local commerce app for independent sellers and service providers.

The product should help small sellers operate with confidence and help buyers discover and transact locally with ease.