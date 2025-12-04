<h1 align="center">🏗️ System Architecture</h1>

<p align="center">
  <strong>Flash Sale Stock Reservation System</strong><br/>
  NestJS + Next.js · PostgreSQL · Redis (Bull queue)
</p>

This document explains how the system is structured, how reservations work end-to-end, and how we prevent overselling while supporting time-limited holds.

---

## 📌 Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Domain Model](#2-domain-model)
3. [Backend Architecture](#3-backend-architecture-nestjs)
4. [Reservation Lifecycle](#4-reservation-lifecycle)
5. [Concurrency & Overselling Protection](#5-concurrency--overselling-protection)
6. [Reset & Demo Data](#6-reset--demo-data)
7. [Frontend Architecture](#7-frontend-architecture-nextjs)
8. [Trade-offs & Limitations](#8-trade-offs--limitations)
9. [Requirements Met](#9-how-it-meets-the-assignment-requirements)

---

## 1. High-Level Overview

### Goals

- Allow users to **reserve products for 2 minutes**
- **Deduct stock immediately** when reserving
- Automatically **expire reservations and restore stock** with no client interaction
- Handle **multiple users** and **concurrent reservations** safely
- Support **mock purchase completion**
- Provide a clean **cosmetics-style frontend** with a visible countdown timer
- Provide a **reset** mechanism to restore the system to a known demo state

### Main Components

```
┌─────────────────────┐         ┌───────────────────┐
│  Next.js Frontend   │◄──────► │ NestJS Backend    │
│  (React, Tailwind)  │  REST   │ (HTTP API)        │
└─────────┬───────────┘         └──────────┬────────┘
          │                               │
          │                       ┌───────┴────────┐
          │                       │  PostgreSQL    │
          │                       │  (Products &   │
          │                       │   Reservations)│
          │                       └───────┬────────┘
          │                               │
          │                       ┌───────┴────────┐
          │                       │ Redis + Bull   │
          │                       │ (Job Queue for │
          │                       │  Expiration)   │
          │                       └────────────────┘
```

<table>
  <tr>
    <th>Component</th>
    <th>Responsibility</th>
  </tr>
  <tr>
    <td><strong>Frontend</strong></td>
    <td>UI/UX, products display, reservations, timers, user actions</td>
  </tr>
  <tr>
    <td><strong>Backend</strong></td>
    <td>Source of truth for products, reservations, stock, expiration</td>
  </tr>
  <tr>
    <td><strong>PostgreSQL</strong></td>
    <td>Persists products and reservations</td>
  </tr>
  <tr>
    <td><strong>Redis + Bull</strong></td>
    <td>Background jobs for reservation expiration and stock restoration</td>
  </tr>
</table>

---

## 2. Domain Model

### 2.1 Product Entity

```typescript
Product {
  id: string;             // UUID
  name: string;
  price: number;
  availableStock: number; // mutable, remaining stock
  createdAt: Date;
  updatedAt: Date;
}
```

**Key behaviors:**
- `availableStock` is decremented when a reservation is created/extended
- `availableStock` is incremented when a reservation expires or is cancelled

### 2.2 Reservation Entity

```typescript
Reservation {
  id: string;                  // UUID
  userId: string;              // client-generated ID
  productId: string;
  quantity: number;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  createdAt: Date;
  expiresAt: Date;             // when reservation becomes invalid
  updatedAt: Date;
}
```

**Key invariants:**
- Each reservation belongs to a single user and product
- For a given `(userId, productId)` there is **at most one ACTIVE reservation**
- `expiresAt` is used by both:
  - Backend jobs (authoritative expiration)
  - Frontend timer (display only)

---

## 3. Backend Architecture (NestJS)

### 3.1 Module Structure

<details>
<summary><strong>ProductsModule</strong></summary>

- Product entity (TypeORM)
- ProductsService (CRUD, list products)
- ProductsController (GET /products)

</details>

<details>
<summary><strong>ReservationsModule</strong></summary>

- Reservation entity (TypeORM)
- ReservationsService (core reservation logic)
- ReservationsController (HTTP endpoints)
- Bull queue configuration (reservations queue)
- Bull processor for expiration jobs

</details>

<details>
<summary><strong>AppModule</strong></summary>

- Configures TypeORM (PostgreSQL)
- Configures Bull (Redis)
- Registers modules

</details>

### 3.2 Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/products` | List all products with available stock |
| `POST` | `/reservations` | Create/extend a reservation |
| `GET` | `/reservations/user/:userId` | Get all reservations for a user |
| `POST` | `/reservations/:id/complete` | Complete a reservation (mock payment) |
| `POST` | `/reservations/:id/cancel` | Cancel and release a reservation |
| `POST` | `/reservations/reset` | Reset demo data (dev only) |

---

## 3.3 Realtime / WebSockets (Socket.IO)

The project includes a realtime layer using Socket.IO (via NestJS WebSocketGateway) to push live stock and reservation updates to connected clients. This keeps product stock and reservation lists in sync across clients without polling.

Key points:

- Packages (example install):

```bash
# server
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io

# client (frontend)
npm install socket.io-client
```

- Backend: implement a `WebSocketGateway` (Socket.IO adapter) that emits events when important state changes occur:
   - On reservation create/extend → emit `product:update` and `reservation:update` (or a combined `reservation:created` event)
   - On reservation expire (background job) → emit `reservation:expired` and `product:update`
   - On reservation cancel → emit `reservation:cancelled` and `product:update`
   - On reservation complete → emit `reservation:completed` (optional: broadcast to analytics/dashboard)

- Frontend: connect with `socket.io-client` and listen for events:
   - `product:update` → update product list stock locally
   - `reservation:update|created|expired|cancelled|completed` → refresh reservation panel or update specific reservation entry

Example server emit payloads (JSON):

```json
// product:update
{ "event": "product:update", "data": { "productId": "uuid", "availableStock": 3 } }

// reservation:update
{ "event": "reservation:update", "data": { "reservationId": "uuid", "userId": "user-123", "productId": "uuid", "quantity": 2, "status": "ACTIVE", "expiresAt": "2025-12-04T12:34:56.000Z" } }
```

Recommendations and notes:

- Use broadcasting for global product updates (e.g., `server.emit('product:update', payload)`). For user-specific events, consider rooms named by `userId` and `socket.join(userId)` to avoid leaking data.
- Always treat server state as authoritative. Clients should reconcile updates by fetching the latest resource when receiving an event if more detail is needed.
- Emit events from the same code paths that change DB state (inside transactions or immediately after commit). If using delayed/worker jobs (Bull), the worker should emit events after successfully expiring a reservation and restoring stock.
- Reconnection handling: on reconnect, client should re-authenticate (if used) and fetch `GET /products` and `GET /reservations/user/:userId` to fully resync state.
- Security: attach a short-lived token (e.g., JWT) on connection (via `auth` payload in Socket.IO) and validate it in the NestJS gateway `handleConnection` to associate sockets with users.

---

## 4. Reservation Lifecycle

This is the core logic of the system.

### 4.1 Create / Extend Reservation

**Endpoint:** `POST /reservations`  
**Input:** `{ userId, productId, quantity }`

<details>
<summary><strong>Steps (inside a DB transaction)</strong></summary>

1. **Lock product row** using TypeORM with `pessimistic_write`
   - Ensures only one transaction updates stock at a time

2. **Validate product & stock**
   - Check product exists
   - Ensure `product.availableStock >= quantity`
   - If not, throw `BadRequestException("Not enough stock")`

3. **Deduct stock**
   - `product.availableStock -= quantity`
   - Save product

4. **Find existing ACTIVE reservation for** `(userId, productId)`
   - **If exists:** merge quantities and extend expiry
     - `existing.quantity += quantity`
     - `existing.expiresAt = now + 2 minutes`
     - Save
   - **Else:** create new reservation
     - `userId, productId, quantity`
     - `status = ACTIVE`
     - `expiresAt = now + 2 minutes`
     - Save

5. **Reset global user window**
   - All ACTIVE reservations for this `userId` get:
   - `expiresAt = now + 2 minutes`
   - This produces a **single global timer per user**
   - Each new reservation extends the window for all their holds

6. **Enqueue expiration job** (optional)
   - Add a Bull job with a delay equal to the TTL
   - Job verifies `expiresAt` before expiring

7. **Commit transaction** and return the reservation

**Result:**
- ✅ Stock is reduced
- ✅ Same product reservations are merged into a single record with higher quantity
- ✅ All active reservations for that user share the latest expiry

</details>

### 4.2 Complete Reservation (Mock Payment)

**Endpoint:** `POST /reservations/:id/complete`

<details>
<summary><strong>Steps (transaction)</strong></summary>

1. Lock reservation row by ID
   - If not found → 404

2. Check reservation status
   - If not ACTIVE → fail with appropriate error
   - Optionally verify `expiresAt > now`

3. Update reservation
   - `status = COMPLETED`
   - Save and commit

4. **Stock unchanged**
   - Stock was deducted at reservation time
   - This models payment completion without a real payment gateway

</details>

### 4.3 Cancel / Release Reservation

**Endpoint:** `POST /reservations/:id/cancel`

Used when user clicks **×** (release) in the UI.

<details>
<summary><strong>Steps (transaction)</strong></summary>

1. Lock reservation by ID
   - If not found → 404

2. Check if ACTIVE
   - If status ≠ ACTIVE, return existing reservation (no stock change)

3. Restore stock
   - `product.availableStock += reservation.quantity`

4. Mark as expired
   - `status = EXPIRED`
   - `expiresAt = now`

5. Save entities and commit

</details>

### 4.4 Automatic Expiration (Background Job)

**Goal:** Expire reservations even when the user is offline and restore stock.

#### Two Compatible Approaches:

**Option A: Periodic Scanner** ⚡ (Recommended for scalability)

```
Every N seconds:
  - SELECT * FROM reservations WHERE status='ACTIVE' AND expiresAt <= now
  - For each reservation:
    - Lock row in transaction
    - Double-check status and expiresAt
    - Mark status = EXPIRED
    - Restore stock
    - Commit
```

**Option B: Per-Reservation Delayed Jobs**

```
On reservation creation:
  - Enqueue a job with delay = TTL

When job runs:
  - Fetch reservation
  - If status=ACTIVE AND expiresAt <= now:
    - Expire and restore stock
  - Else:
    - Do nothing (user likely got a new global window)
```

> **Important Invariant:** The only truth for expiration is `expiresAt`. Jobs only act when `expiresAt <= now`; they don't blindly expire based on a fixed delay.

---

## 5. Concurrency & Overselling Protection

### 5.1 Stock Safety

All stock changes happen inside **database transactions** with row-level locking.

The product row is locked with `pessimistic_write` before:
- Checking `availableStock`
- Deducting `quantity`

**Guarantees:**
- Two concurrent reservations cannot both see the same stock
- If stock is insufficient, the later transaction fails with "Not enough stock"

### 5.2 Reservation Safety

Reservation rows are also locked in transactions when:
- Completing a reservation
- Cancelling a reservation
- Expiring a reservation (background job)

**Prevents:**
- ✅ Double completion
- ✅ Double cancel/expire
- ✅ Races between completion and expiration

### 5.3 Edge Cases Handled

| Scenario | How It's Handled |
|----------|-----------------|
| **Two users reserve the last item** | Only one succeeds due to stock check under lock |
| **User completes at same time as expiration** | First committer wins; second sees non-ACTIVE status and skips |
| **User reserves more than available** | Backend validation returns 400; frontend shows error toast |
| **Server restarts** | Data persists in PostgreSQL; `expiresAt` allows detecting overdue reservations |

---

## 6. Reset & Demo Data

### 6.1 Reset Endpoint

**Endpoint:** `POST /reservations/reset` (dev/demo only)

<details>
<summary><strong>Steps (transaction)</strong></summary>

1. DELETE all rows from `reservation` (child table)
2. DELETE all rows from `product`
3. INSERT a fixed set of demo products (name, price, stock)

**Reasoning:**
- Makes it easy to reset the environment during testing or demos
- Avoids needing a separate seeding script
- Endpoint wired to "Reset demo data" button in frontend

</details>

---

## 7. Frontend Architecture (Next.js)

### 7.1 Tech Stack

- **Framework:** Next.js (App Router)
- **UI:** React hooks + function components
- **Language:** TypeScript
- **Styling:** Tailwind CSS utilities via `app/globals.css`

### 7.2 Key Files & Components

<details>
<summary><strong>app/layout.tsx</strong></summary>

- Page shell and global styling
- Cosmetics brand header
- Common layout wrapper

</details>

<details>
<summary><strong>app/page.tsx</strong></summary>

- Initial route
- Renders `<ProductsPage />`

</details>

<details>
<summary><strong>components/ProductsPage.tsx</strong></summary>

Main UI and state management:
- Fetch products & reservations on mount
- Manage selected product + quantity
- Handle create reservation / complete / cancel
- Display products grid
- Display "Your reservations" panel
- Control payment modal
- Implement demo reset button
- Dispatch toasts

</details>

<details>
<summary><strong>hooks/useReservationTimer.ts</strong></summary>

Countdown timer hook:
- Takes `expiresAt` ISO string and `onElapsed` callback
- Computes remaining time with `setInterval`
- Exposes `{ remainingMs, mm, ss }`
- Calls `onElapsed()` once when countdown hits zero

</details>

<details>
<summary><strong>lib/api.ts</strong></summary>

API helper:
- `fetchJSON(path, options)` prefixes path with `NEXT_PUBLIC_API_BASE_URL`
- Throws for non-OK responses with error message

</details>

<details>
<summary><strong>lib/user.ts</strong></summary>

User ID management:
- Generates or retrieves pseudo-userId from localStorage
- Used to group reservations per user

</details>

### 7.3 Frontend Flow

#### Initial Load

On mount, frontend:
1. Fetches `GET /products`
2. Fetches `GET /reservations/user/:userId`
3. Derives:
   - Active reservations (status = ACTIVE)
   - Maximum `expiresAt` among them → timer target

#### Reservation Creation

1. User selects a product and sets quantity
2. Clicks "Reserve for 2 minutes"
3. Frontend calls `POST /reservations`
4. On success:
   - Shows success toast
   - Calls `GET /products` and `GET /reservations/user/:userId` to sync
5. UI updates:
   - Combined quantity for that product
   - Global timer extended

#### Timer Behavior

`useReservationTimer` uses the latest `expiresAt` across active reservations.

Shows **Expires in mm:ss** in "Your reservations" panel.

When countdown reaches 0:
- Reloads products & reservations from backend
- Shows info toast ("Reservations synced – some may have expired…")
- Ensures UI stays in sync even if background jobs expired reservations

#### Completing a Reservation

1. User clicks "Complete" beside a reservation
2. Modal opens; on confirm:
   - `POST /reservations/:id/complete`
3. On success:
   - Toast success
   - Reload all data
4. If backend says already expired:
   - Show error toast

#### Releasing a Reservation

1. User clicks the small **×** on a reservation row
2. Frontend calls `POST /reservations/:id/cancel`
3. On success:
   - Toast info ("Released hold, stock restored")
   - Reload all data

#### Reset Demo Data

1. User clicks "Reset demo data"
2. Confirmation dialog appears
3. If confirmed:
   - `POST /reservations/reset`
   - Reload data
   - Clear selected product
   - Toast success

---

## 8. Trade-offs & Limitations

### 8.1 Simplifications Made

| Aspect | Current Approach | Production Consideration |
|--------|------------------|-------------------------|
| **Authentication** | Client-managed userId | Implement real auth with JWT/session |
| **Time Sync** | Server generates expiresAt | Small clock drift is acceptable |
| **Job Strategy** | Per-reservation or periodic | Batched scanner more efficient at scale |
| **Reset Endpoint** | Public for demo | Would be protected or removed in prod |

### 8.2 Possible Enhancements

- 🔐 Real authentication using user identity from JWT/session
- 🗄️ Replace `synchronize` with proper migrations
- ⏱️ Add rate-limiting and auth around reset
- 📊 Add dashboards:
  - Total reserved, completed, expired counts
  - Per-product metrics
- ⚡ Optimistic UI updates to reduce refetching
- 📱 Enhanced mobile responsiveness
- 🔔 Real-time notifications via WebSockets

---

## 9. How It Meets the Assignment Requirements

### ✅ Prevents Overselling

Stock checks and deductions run under **row-level locks** in a DB transaction. The product row lock ensures that stock availability is always verified atomically before deduction.

### ✅ Automatic Expiration

`expiresAt` + background jobs expire reservations and restore stock with **no client calls**. Works even when the user is offline.

### ✅ Accurate Stock Tracking

- Stock **deducted** on reservation
- Stock **restored** on expiration/cancel only
- Completion does **not** double-count

### ✅ Multiple Users & Concurrency

Per-product row locking avoids race conditions. Same product for same user merges quantity into a single reservation.

### ✅ Timer & UI Behavior

Timer persists across refresh because it's derived from backend `expiresAt`. UI syncs after timer lapse and operations.

### ✅ Reset & Demo

`POST /reservations/reset` + "Reset demo data" button makes it easy to demo all flows cleanly from a known state.

---

## 📚 Summary

This architecture balances:
- **Correctness:** Row-level locking prevents overselling
- **Simplicity:** Single source of truth for expiration (`expiresAt`)
- **Reliability:** Automatic background jobs ensure stock restoration
- **User Experience:** Polished ecommerce-style UI with visible countdown timers and smooth interactions
