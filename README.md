# MediCore Distribution

**Production-Grade Pharmacy Operations Platform**

A microservices-based platform serving **18 branches** with **~400 concurrent users**, supporting low-bandwidth environments.

## Features

- 🔐 **Secure Auth** – JWT access tokens, refresh token rotation, RBAC (4 roles)
- 📦 **Inventory Management** – Real-time centralized stock tracking, low-stock alerts, branch transfers
- 💊 **Billing** – Invoice generation with multi-item, discount, tax support
- 🛒 **Purchase Orders** – Supplier management, PO lifecycle tracking
- 📊 **Analytics** – Sales dashboards, inventory snapshots, branch comparisons
- 🤖 **AI Assistant** – Natural language queries with OpenAI + rule-based fallback
- 🔔 **Notifications** – In-app, email, and event-driven low-stock alerts
- 📡 **Event-Driven** – RabbitMQ message queue for async service communication
- ⚡ **Low-Bandwidth Ready** – Gzip compression, Redis caching, paginated APIs

## Services

| Service              | Port | Description                          |
|----------------------|------|--------------------------------------|
| API Gateway          | 3000 | Entry point, JWT auth, rate limiting |
| Auth Service         | 3001 | Login, register, token management    |
| User Service         | 3002 | User profiles, branch management     |
| Inventory Service    | 3003 | Stock tracking, transfers, alerts    |
| Billing Service      | 3004 | Invoices, payments                   |
| Purchase Service     | 3005 | Purchase orders, suppliers           |
| Analytics Service    | 3006 | Dashboards, trends, snapshots        |
| AI Assistant Service | 3007 | Natural language queries             |
| Notification Service | 3008 | In-app, email, SMS alerts            |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full architecture diagram, service interaction flows, and design decisions.

## Quick Start

### Prerequisites
- Docker 24+
- Docker Compose v2+

### Setup

```bash
# Clone the repository
git clone https://github.com/Abhivamsh/MediCore-Distribution.git
cd MediCore-Distribution

# Copy environment configuration
cp .env.example .env
# Edit .env and set your secrets (JWT_SECRET, POSTGRES_PASSWORD, etc.)

# Start all services
docker-compose up -d

# Check service health
docker-compose ps
```

The API Gateway will be available at `http://localhost:3000`.

### API Endpoints

#### Authentication
```
POST /api/auth/register   – Register new user
POST /api/auth/login      – Login and get tokens
POST /api/auth/refresh    – Refresh access token
POST /api/auth/logout     – Invalidate refresh token
GET  /api/auth/me         – Get current user (auth required)
```

#### Inventory
```
GET  /api/inventory                    – List stock (branch-scoped)
GET  /api/inventory/products/:id       – Product details with stock
POST /api/inventory/products           – Create product
POST /api/inventory/stock/adjust       – Adjust stock (receive/dispense)
GET  /api/inventory/alerts             – Low-stock and out-of-stock alerts
GET  /api/inventory/transfers          – List transfers
POST /api/inventory/transfers          – Request stock transfer
PATCH /api/inventory/transfers/:id/approve  – Approve transfer
```

#### Billing
```
GET  /api/billing/invoices             – List invoices
GET  /api/billing/invoices/:id         – Invoice details
POST /api/billing/invoices             – Create invoice
GET  /api/billing/summary              – Revenue summary (today/week/month)
```

#### Purchase Orders
```
GET  /api/purchases                    – List purchase orders
GET  /api/purchases/:id                – PO details
POST /api/purchases                    – Create purchase order
PATCH /api/purchases/:id/receive       – Mark PO as received
GET  /api/purchases/suppliers          – List suppliers
POST /api/purchases/suppliers          – Add supplier
```

#### Analytics
```
GET /api/analytics/dashboard           – Sales dashboard
GET /api/analytics/sales/by-branch     – Revenue by branch
GET /api/analytics/inventory/snapshot  – Inventory health snapshot
GET /api/analytics/top-products        – Top-selling products
```

#### AI Assistant
```
POST /api/ai/query                     – Natural language query
GET  /api/ai/recommendations           – Automated recommendations
GET  /api/ai/query-history             – Query history for current user
```

#### Notifications
```
GET   /api/notifications               – List notifications
PATCH /api/notifications/:id/read      – Mark as read
PATCH /api/notifications/read-all      – Mark all as read
POST  /api/notifications/send          – Send notification (internal)
```

## Running Tests

```bash
# Install root dependencies
npm install

# Run architecture validation tests
npm test
```

## Environment Variables

See [.env.example](./.env.example) for all required environment variables.

Key variables to configure:
- `JWT_SECRET` – Must be at least 64 random characters
- `JWT_REFRESH_SECRET` – Separate secret for refresh tokens
- `POSTGRES_PASSWORD` – Database password
- `REDIS_PASSWORD` – Redis authentication password
- `RABBITMQ_PASSWORD` – RabbitMQ password
- `OPENAI_API_KEY` – Optional; AI assistant falls back to rule-based responses

## Roles

| Role               | Access Level                                                    |
|--------------------|-----------------------------------------------------------------|
| `super_admin`      | All branches, all operations, user management                  |
| `regional_manager` | Cross-branch read access, analytics, approve transfers         |
| `inventory_manager`| Own branch stock management, transfer requests                 |
| `pharmacist`       | Own branch billing, view inventory                             |

## Technology Stack

| Layer            | Technology                        |
|------------------|-----------------------------------|
| Runtime          | Node.js 20 LTS                    |
| Framework        | Express 4                         |
| Database         | PostgreSQL 15                     |
| Cache            | Redis 7                           |
| Message Queue    | RabbitMQ 3.12                     |
| Reverse Proxy    | Nginx 1.25                        |
| Containers       | Docker + Docker Compose           |
| Authentication   | JWT (jsonwebtoken) + bcryptjs     |
| AI               | OpenAI GPT-4o-mini                |

## License

MIT
