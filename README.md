<p align="center">
  <img src="https://cdn-icons-png.flaticon.com/512/891/891462.png" width="96" alt="Flash Sale Logo" />
</p>

<h1 align="center">Flash Sale Stock Reservation System</h1>

<p align="center">
  NestJS + Next.js demo for time-limited stock reservations with background expiration, queues, and ecommerce-style UI.
</p>

<p align="center">
  <a href="https://nodejs.org/en" target="_blank"><img src="https://img.shields.io/badge/node-%3E=18.0.0-brightgreen" alt="Node.js Version" /></a>
  <a href="https://nestjs.com" target="_blank"><img src="https://img.shields.io/badge/NestJS-backend-E0234E?logo=nestjs&logoColor=white" alt="NestJS" /></a>
  <a href="https://nextjs.org" target="_blank"><img src="https://img.shields.io/badge/Next.js-frontend-000000?logo=nextdotjs&logoColor=white" alt="Next.js" /></a>
  <a href="https://www.postgresql.org" target="_blank"><img src="https://img.shields.io/badge/PostgreSQL-DB-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" /></a>
  <a href="https://redis.io" target="_blank"><img src="https://img.shields.io/badge/Redis-queue-DC382D?logo=redis&logoColor=white" alt="Redis" /></a>
  <a href="#" target="_blank"><img src="https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socket.io&logoColor=white" alt="Socket.IO" /></a>
  <a href="./LICENSE" target="_blank"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
</p>

---

## 📋 Overview

This project is a **Flash Sale Stock Reservation System** built with:

- **Backend:** NestJS, TypeORM, PostgreSQL, Bull (Redis)
- **Frontend:** Next.js, React, TypeScript, Tailwind (via `globals.css` only)

### Core Features

- Users can **reserve products for 2 minutes**
- Stock is **deducted immediately** and restored automatically on expiration (via background jobs)
- Multiple users can reserve the same product safely without overselling
- Same product reserved multiple times by the same user **merges quantity** into one reservation
- A single **global timer window per user** is reset based on the **last reservation**
- Reset endpoint / button restores the database to a clean demo state

The UI is styled like a **cosmetics ecommerce brand** and is responsive for mobile and tablet.

---

## 📁 Project Structure

```
.
├─ backend/    # NestJS API (products, reservations, queues)
├─ frontend/   # Next.js UI (cosmetics-themed flash sale app)
└─ ARCHITECTURE.md
```

- **backend/README.md** – backend-specific instructions
- **frontend/README.md** – frontend-specific instructions
- **ARCHITECTURE.md** – detailed architecture, flows, and trade-offs

---

## ⚙️ Environment Configuration

### Backend `.env` (in `backend/.env`)

<details>
<summary>Example configuration</summary>

```bash
# HTTP
PORT=4000

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=flash_sale

# TypeORM
DB_SYNCHRONIZE=true   # for dev/demo only

# Redis (Bull queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# Reservation TTL (2 minutes)
RESERVATION_TTL_MS=120000
```

</details>

Make sure PostgreSQL and Redis are running locally, or point these values to your services.

### Realtime / Socket.IO

If you enabled realtime updates, the backend uses Socket.IO to broadcast product/reservation changes.

Install on the server:

```bash
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
```

Install on the client (frontend):

```bash
npm install socket.io-client
```

### Frontend `.env.local` (in `frontend/.env.local`)

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
```

The frontend uses this to call the NestJS API.

---

## 🐳 Docker Setup

### Quick Start with Docker Compose

<details>
<summary>Using Docker Compose (recommended)</summary>

Create a `docker-compose.yml` file in the root directory:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: flash_sale_postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: flash_sale
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: flash_sale_redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

Then run:

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# Remove volumes (clears data)
docker-compose down -v
```

</details>

### Manual Docker Commands

#### PostgreSQL

```bash
# Run PostgreSQL container
docker run -d \
  --name flash_sale_postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=flash_sale \
  -p 5432:5432 \
  -v postgres_data:/var/lib/postgresql/data \
  postgres:15-alpine

# Connect to PostgreSQL
docker exec -it flash_sale_postgres psql -U postgres -d flash_sale

# Stop & remove
docker stop flash_sale_postgres
docker rm flash_sale_postgres
```

#### Redis

```bash
# Run Redis container
docker run -d \
  --name flash_sale_redis \
  -p 6379:6379 \
  -v redis_data:/data \
  redis:7-alpine

# Connect to Redis CLI
docker exec -it flash_sale_redis redis-cli

# Stop & remove
docker stop flash_sale_redis
docker rm flash_sale_redis
```

### Using Existing Containers

If you already have PostgreSQL/Redis running:

```bash
# Check if containers are running
docker ps

# View container logs
docker logs flash_sale_postgres
docker logs flash_sale_redis

# Check container health
docker ps --filter "name=flash_sale"
```

---

## 🚀 Getting Started

### Backend

From the backend folder:

<details>
<summary>Development & Production Commands</summary>

```bash
# development
npm run start

# watch mode (recommended for dev)
npm run start:dev

# production build & start
npm run build
npm run start:prod
```

</details>

**Default backend URL:** `http://localhost:4000`

### Frontend

From the frontend folder:

<details>
<summary>Development & Production Commands</summary>

```bash
# development
npm run dev

# production build & start
npm run build
npm run start
```

</details>

**Default frontend URL:** `http://localhost:3000`

---

## 🎯 Core Features & Behavior

### Flash Sale & Reservation Rules

**Products have `availableStock`.**

**When a user reserves:**
- Stock is deducted immediately within a DB transaction
- A reservation is created with:
  - `status = ACTIVE`
  - `expiresAt = now + 2 minutes`

**If the same user reserves the same product again while the reservation is active:**
- Quantity is added to the existing reservation (no duplicate rows)

**When the user has any active reservations and makes a new one:**
- All active reservations for that user get their `expiresAt` pushed to `now + 2 minutes` (global timer behavior)

### Expiration & Background Jobs

**Background worker (Bull + Redis) enforces expiration:**
- Finds reservations where `status = ACTIVE` and `expiresAt <= now`
- Marks them as `EXPIRED` and restores stock to the product

**This works even if:**
- The frontend is closed
- The user never returns
- The server restarts (as long as jobs/scan resume)

### Frontend UX & Behavior

**Cosmetics-brand homepage with:**
- Product cards (name, price, stock)
- "Tap to select" to open reservation details

**Side panel "Your reservations" shows:**
- All active reservations for the current user
- Combined quantity per product (no duplicates)
- Global timer badge: **Expires in mm:ss**
- **Complete** button → opens mock payment modal → marks reservation as COMPLETED
- **×** (Release) button → cancels reservation early and restores stock

**Timer:**
- Uses the latest `expiresAt` among the user's active reservations
- When countdown reaches 0, the frontend:
  - Calls backend to reload products & reservations
  - Shows an info toast ("some reservations may have expired…")

**Notifications (toasts):**
- Reservation success / failure (e.g., not enough stock)
- Completion success / expiration error
- Reset success
- Sync info messages

**Reset:**
- Small "Reset demo data" button at the top
- Calls `POST /reservations/reset` on the backend
- Backend:
  - Deletes all reservations
  - Deletes all products
  - Seeds default demo products
- Frontend reloads state and clears current selection

---

## 🧪 Running Tests

### Backend (NestJS)

From backend:

```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e

# test coverage
npm run test:cov
```

### Frontend (optional)

From frontend (if you add tests):

```bash
# lint
npm run lint

# unit/component tests (if configured)
npm run test
```

---

## 📡 API Overview

### Products

| Endpoint | Description |
|----------|-------------|
| `GET /products` | List all products with `availableStock` |

### Reservations

| Endpoint | Description |
|----------|-------------|
| `POST /reservations` | Create/extend a reservation for a given userId and productId. Deducts stock. Merges same-product reservations for that user. Resets the global user expiry window. |
| `GET /reservations/user/:userId` | List all reservations (ACTIVE, COMPLETED, EXPIRED) for a user, including product info |
| `POST /reservations/:id/complete` | Mark reservation as COMPLETED (mock payment, no additional stock change) |
| `POST /reservations/:id/cancel` | Manually cancel reservation, mark as EXPIRED, and restore stock |
| `POST /reservations/reset` | Dev-only: clear all data and seed default products (used by "Reset demo data" in UI) |

<p><em>Full details (transactions, locking, concurrency) are in <strong>ARCHITECTURE.md</strong>.</em></p>

---

## 🚀 Deployment

When deploying:

- Run migrations instead of `synchronize` in production
- Provide PostgreSQL and Redis services (Docker or managed)
- Expose:
  - Backend HTTP port (e.g., 4000)
  - Frontend HTTP port (e.g., 3000) or build as static/Node app

For a simple Docker-based deployment, you can:

- Containerize backend and frontend separately
- Use environment variables for DB/Redis/API URL
- Put them behind a reverse proxy (NGINX, etc)

---

## 📚 Resources

- [NestJS Documentation](https://docs.nestjs.com)
- [Next.js Documentation](https://nextjs.org/docs)
- [TypeORM Documentation](https://typeorm.io)
- [Bull (Redis queue) Documentation](https://docs.bullmq.io)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

<p><em>For deeper architecture notes, see <strong>ARCHITECTURE.md</strong>.</em></p>

---

## 📄 License

This project is released under the [MIT License](./LICENSE).
