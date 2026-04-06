# MediCore Distribution – System Architecture

## Overview

MediCore Distribution is a **production-grade microservices platform** for pharmacy operations, designed to support **18 branches** and **~400 concurrent users** under low-bandwidth constraints.

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                             EXTERNAL CLIENTS                                       │
│   Branch Staff (Pharmacists, Inventory Managers, Regional Managers, Super Admin)  │
│           Web Browser / Mobile App (18 Branches × ~22 concurrent users)           │
└───────────────────────────────────┬────────────────────────────────────────────────┘
                                    │ HTTPS
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              NGINX (Reverse Proxy)                                │
│  • TLS termination          • Gzip compression        • Static asset caching     │
│  • Connection pooling        • Low-bandwidth optimization                         │
│  Port: 80 / 443                                                                   │
└───────────────────────────────────┬───────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY   :3000                                      │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  Middleware Stack:                                                           │ │
│  │  [Helmet] → [CORS] → [Compression] → [Rate Limiter] → [JWT Verify]         │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  Routes (Reverse Proxy):                                                          │
│  PUBLIC:   /api/auth          → Auth Service                                      │
│  PRIVATE:  /api/users         → User Service                                      │
│            /api/inventory     → Inventory Service                                 │
│            /api/billing       → Billing Service                                   │
│            /api/purchases     → Purchase Service                                  │
│            /api/analytics     → Analytics Service                                 │
│            /api/ai            → AI Assistant Service                              │
│            /api/notifications → Notification Service                              │
└──────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────────┘
       │        │        │        │        │        │        │        │
       ▼        ▼        ▼        ▼        ▼        ▼        ▼        ▼
  ┌────────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
  │ Auth   │ │ User │ │ Inv. │ │Billi.│ │Purch.│ │Anal. │ │  AI  │ │Notif.│
  │ :3001  │ │:3002 │ │:3003 │ │:3004 │ │:3005 │ │:3006 │ │:3007 │ │:3008 │
  └────────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
       │        │        │        │        │        │        │        │
       └────────┴────────┴────────┴────────┴────────┴────────┴────────┘
                                    │
          ┌─────────────────────────┼──────────────────────────┐
          │                         │                          │
          ▼                         ▼                          ▼
  ┌──────────────┐        ┌──────────────────┐        ┌──────────────┐
  │  PostgreSQL  │        │      Redis        │        │  RabbitMQ    │
  │  :5432       │        │      :6379        │        │  :5672       │
  │              │        │                  │        │              │
  │  6 databases │        │  • Session cache  │        │ Topic Exch.  │
  │  (one/svc)   │        │  • Query cache    │        │ medicore     │
  │              │        │  • Rate limit     │        │ .events      │
  └──────────────┘        └──────────────────┘        └──────────────┘
```

---

## Microservices

### 1. API Gateway  `:3000`
**Responsibility:** Single entry point for all client requests.

| Concern          | Implementation                                             |
|------------------|------------------------------------------------------------|
| Security         | Helmet, CORS, rate limiting (100 req/min per client)      |
| Authentication   | JWT verification; injects `x-user-id`, `x-user-role`, `x-branch-id` headers |
| Routing          | HTTP reverse proxy (`http-proxy-middleware`)               |
| Compression      | Gzip via `compression` middleware (low-bandwidth friendly) |
| Resilience       | Graceful 502 on downstream failure                        |

---

### 2. Auth Service  `:3001`
**Responsibility:** Authentication, JWT management, RBAC.

| Feature               | Detail                                                  |
|-----------------------|---------------------------------------------------------|
| Registration/Login    | Email + bcrypt-hashed password                         |
| Access Tokens         | JWT, 15-minute TTL                                     |
| Refresh Tokens        | SHA-256 hashed, stored in DB, 7-day TTL, rotated on use |
| Session Cache         | Redis: user profile cached for 15 min after login      |
| Roles                 | `super_admin`, `regional_manager`, `inventory_manager`, `pharmacist` |

**Database:** `medicore_auth`  
Tables: `users`, `refresh_tokens`

---

### 3. User Service  `:3002`
**Responsibility:** User profiles and branch management.

| Feature         | Detail                                           |
|-----------------|--------------------------------------------------|
| User CRUD       | List, get, create, update users                 |
| Branch CRUD     | Manage all 18 branches (name, code, city, state)|
| Access Control  | Non-admin users see only their branch data      |

**Database:** `medicore_users`  
Tables: `users`, `branches`

---

### 4. Inventory Service  `:3003`
**Responsibility:** Centralized real-time stock tracking across all 18 branches.

| Feature              | Detail                                                |
|----------------------|-------------------------------------------------------|
| Product Catalog      | SKU, name, category, unit price, reorder level       |
| Stock Management     | Per-branch, per-batch stock with movement history    |
| Stock Adjustments    | Receive, dispense, adjust – all transactional        |
| Low-Stock Alerts     | Real-time query: quantity ≤ reorder_level            |
| Branch Transfers     | Request → Approve workflow with stock validation     |
| Events Published     | `inventory.updated`, `inventory.transfer.*`          |

**Database:** `medicore_inventory`  
Tables: `products`, `stock`, `stock_movements`, `stock_transfers`

---

### 5. Billing Service  `:3004`
**Responsibility:** Invoice generation and payment workflows.

| Feature           | Detail                                                  |
|-------------------|---------------------------------------------------------|
| Invoice Creation  | Multi-item with discounts, tax, multiple payment modes  |
| Invoice Numbering | Auto-generated: `INV-{branch}-{YYYYMMDD}-{rand}`       |
| Summary           | Revenue metrics by period (today/week/month)           |
| Events Published  | `billing.invoice.created`                              |

**Database:** `medicore_billing`  
Tables: `invoices`, `invoice_items`

---

### 6. Purchase Service  `:3005`
**Responsibility:** Purchase orders and supplier management.

| Feature               | Detail                                                |
|-----------------------|-------------------------------------------------------|
| Purchase Orders       | Draft → Approved → Received lifecycle                |
| PO Numbering          | Auto-generated: `PO-{branch}-{YYYYMMDD}-{rand}`      |
| Supplier Management   | Supplier catalog with contact info                   |
| Events Published      | `purchase.order.created`, `purchase.order.received`  |

**Database:** `medicore_purchase`  
Tables: `suppliers`, `purchase_orders`, `purchase_order_items`

---

### 7. Analytics Service  `:3006`
**Responsibility:** Aggregated dashboards, sales trends, inventory snapshots.

| Feature              | Detail                                                   |
|----------------------|----------------------------------------------------------|
| Dashboard API        | Revenue, invoices, average per period (30/7/1 day)     |
| Sales by Branch      | Branch-level revenue comparison                         |
| Inventory Snapshot   | SKU count, low-stock, out-of-stock, total value         |
| Top Products         | Most-sold items per period                              |
| Event Consumer       | Consumes `billing.invoice.*` to build daily snapshots  |
| Caching              | Redis: dashboard data cached for 5 minutes              |

**Database:** `medicore_analytics`  
Tables: `daily_sales_snapshots`, `inventory_snapshots`

---

### 8. AI Assistant Service  `:3007`
**Responsibility:** Intelligent query answering and operational recommendations.

| Feature               | Detail                                                   |
|-----------------------|----------------------------------------------------------|
| Natural Language      | Processes free-text queries from pharmacy staff          |
| OpenAI Integration    | GPT-4o-mini with domain-specific system prompt          |
| Rule-Based Fallback   | Keyword-based responses when no API key configured      |
| Response Caching      | Redis: identical queries cached for 5 minutes           |
| Recommendations       | Automated recommendations based on inventory snapshots  |
| Query Audit           | All queries logged with tokens used and latency         |

---

### 9. Notification Service  `:3008`
**Responsibility:** Multi-channel alerting (in-app, email, SMS).

| Feature               | Detail                                                  |
|-----------------------|---------------------------------------------------------|
| In-App Notifications  | Stored in DB, read/unread status                       |
| Email                 | SMTP via nodemailer                                    |
| Event Consumer        | Consumes `inventory.updated` for low-stock alerts      |
| Broadcast             | Send to user, branch, or all                           |

**Database:** Shared with analytics (`medicore_analytics`)  
Tables: `notifications`

---

## Event-Driven Communication

```
Service                Event Routing Key              Consumers
──────────────────     ───────────────────────────    ──────────────────────────
Billing Service    →   billing.invoice.created     →  Analytics Service
                                                   →  Notification Service
                                                   →  Inventory Service (deduct)

Inventory Service  →   inventory.updated           →  Notification Service (low stock)
                   →   inventory.transfer.created  →  Notification Service
                   →   inventory.transfer.approved →  Analytics Service

Purchase Service   →   purchase.order.created      →  Notification Service
                   →   purchase.order.received     →  Inventory Service (restock)
```

**Exchange:** `medicore.events` (RabbitMQ Topic Exchange)  
**Pattern:** Durable queues, persistent messages, manual ack, nack-discard on error

---

## Service Interaction Flow Example

### Billing → Inventory → Analytics → AI

```
Pharmacist creates invoice
         │
         ▼
[API Gateway] — verify JWT → forward to Billing Service
         │
         ▼
[Billing Service]
  1. Begin DB transaction
  2. Generate invoice + items
  3. Commit
  4. Publish → billing.invoice.created {invoiceId, branchId, items, total}
         │
         ├──────────────────────────────────────────────┐
         │                                              │
         ▼                                              ▼
[Analytics Service]                          [Inventory Service]
  Upsert daily_sales_snapshots                Deduct stock per item
  (branch_id, date, revenue,                  Record stock_movements
   invoice_count)                             Publish → inventory.updated
         │                                              │
         │                                              ▼
         │                                  [Notification Service]
         │                                    If quantity ≤ reorder_level:
         │                                    Insert low_stock notification
         │
         ▼ (async, user queries)
[AI Assistant Service]
  User: "Which products need restocking at Branch 5?"
  AI queries analytics DB → inventory_snapshots
  Returns: "3 products below reorder level: Paracetamol 500mg..."
```

---

## Database Design

Each microservice owns its own PostgreSQL database (Database-per-Service pattern):

| Service          | Database              | Key Tables                              |
|------------------|-----------------------|-----------------------------------------|
| Auth             | medicore_auth         | users, refresh_tokens                   |
| User             | medicore_users        | users, branches                         |
| Inventory        | medicore_inventory    | products, stock, stock_movements, transfers |
| Billing          | medicore_billing      | invoices, invoice_items                 |
| Purchase         | medicore_purchase     | suppliers, purchase_orders, po_items    |
| Analytics        | medicore_analytics    | daily_sales_snapshots, inventory_snapshots |
| Notification     | medicore_analytics    | notifications                           |
| AI               | medicore_analytics    | ai_query_log                            |

---

## Caching Strategy (Redis)

| Cache Key Pattern                  | TTL     | Cached By           |
|------------------------------------|---------|---------------------|
| `user:{userId}`                    | 15 min  | Auth Service        |
| `analytics:dashboard:{branch}:{p}` | 5 min   | Analytics Service   |
| `analytics:sales-by-branch:{p}`    | 5 min   | Analytics Service   |
| `analytics:inventory-snapshot:{b}` | 1 min   | Analytics Service   |
| `ai:query:{hash}`                  | 5 min   | AI Service          |

---

## Role-Based Access Control (RBAC)

| Role               | Level | Capabilities                                                        |
|--------------------|-------|---------------------------------------------------------------------|
| `super_admin`      | 4     | Full access: all branches, user management, system configuration    |
| `regional_manager` | 3     | Cross-branch read, approve transfers, analytics across region      |
| `inventory_manager`| 2     | Stock management for own branch, transfer requests                 |
| `pharmacist`       | 1     | Billing, view own branch inventory                                  |

Branch isolation is enforced at each service level via the `x-branch-id` header injected by the API Gateway.

---

## Security Design

| Layer             | Control                                                              |
|-------------------|----------------------------------------------------------------------|
| Transport         | HTTPS/TLS via Nginx                                                 |
| Authentication    | JWT Access Tokens (15m) + Refresh Token Rotation                   |
| Authorization     | Role-based, branch-scoped access in every service                  |
| Secrets           | All secrets via environment variables, never hardcoded              |
| Rate Limiting     | 100 req/min per IP at API Gateway                                   |
| Input Validation  | `express-validator` on all mutation endpoints                       |
| SQL Injection     | Parameterized queries only (pg library)                             |
| Container         | Non-root user (`medicore`) in all Docker containers                |
| Headers           | Helmet sets CSP, HSTS, X-Frame-Options, etc.                       |
| Token Storage     | Refresh tokens stored as SHA-256 hashes                            |

---

## Low-Bandwidth Optimizations

| Strategy                    | Implementation                                         |
|-----------------------------|--------------------------------------------------------|
| Response Compression        | Gzip at Nginx + Express middleware level               |
| Payload Size Limits         | API Gateway enforces 1MB max; services use 256KB limit|
| Request Body Buffering      | Nginx tuned buffers for slow uplinks                  |
| API Pagination              | All list endpoints paginated (default 20 records)     |
| Redis Caching               | Dashboard and analytics responses cached 5 minutes    |
| Connection Keepalive        | Nginx upstream keepalive (32 connections)             |
| Timeouts                    | 30s connect, 60s read/write at Nginx proxy            |

---

## Design Decisions

### 1. Database-per-Service
Each service has an isolated PostgreSQL database to ensure:
- Independent schema evolution
- Fault isolation (one service's DB failure doesn't cascade)
- Service ownership and clear data contracts

### 2. Event-Driven for Cross-Service Coordination
RabbitMQ Topic Exchange enables loose coupling:
- Billing doesn't call Inventory directly – it publishes an event
- Analytics is updated asynchronously without blocking the billing response
- New consumers can be added without changing producers

### 3. Synchronous REST for Client Requests
REST via the API Gateway for:
- Immediate response needed (billing confirmation, stock lookup)
- Simpler client implementation
- Easy debugging and tracing

### 4. JWT with Refresh Token Rotation
- Short-lived access tokens (15min) minimize breach window
- Refresh tokens are single-use (rotated each time) to detect token theft
- Hashed storage of refresh tokens protects against DB breach

### 5. Redis Caching for Analytics
Analytics queries run on aggregated snapshots + Redis cache:
- Dashboard loads in < 50ms for cached data
- 5-minute TTL balances freshness vs. performance
- Works well under low-bandwidth (fewer DB round-trips)

### 6. Horizontal Scalability
- Stateless services (state in DB/Redis) – can scale horizontally
- API Gateway can be load-balanced behind Nginx
- RabbitMQ prefetch=1 ensures fair work distribution among consumer replicas

### 7. Fault Tolerance
- Each service has HEALTHCHECK in Docker
- RabbitMQ consumers use manual ack + nack-discard (no infinite loops)
- Redis/RabbitMQ connection failures are non-fatal (services degrade gracefully)
- API Gateway returns 502 (not crash) on downstream failure

### 8. 18 Branches Support
- Branch ID validated as integer 1–18 on all relevant endpoints
- Branch-scoped access enforced at middleware level
- Regional Managers can see cross-branch analytics
- Stock transfers between branches go through an approval workflow
