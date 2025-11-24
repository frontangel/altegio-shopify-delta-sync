# Altegio → Shopify Sync Service

This service receives webhooks from Altegio and synchronizes inventory quantities in Shopify by matching products via SKU.

The repository uses Node.js (ESM) with Express and Shopify GraphQL API. It keeps a lightweight in-memory cache and a simple background queue to smooth out Shopify API rate limits.

---

## Overview

What it does:

- Receives Altegio webhooks (e.g., goods operations) and validates payloads
- Maps Altegio articles (SKU) to Shopify variant inventory items
- Updates Shopify inventory quantities via GraphQL Admin API
- Persists a small in-memory cache and minimal queue (with backoff and disk persistence)
- Provides basic internal endpoints for health, cache inspection, and logs

---

## Stack

- Runtime: Node.js (>= 20, ESM)
- Web framework: Express 5
- Templates: EJS (for simple logs UI)
- Shopify API: graphql-request
- Validation: zod
- Config loader: dotenv
- Caching/State: in-memory via CacheManager

Package manager: Yarn is present (yarn.lock), but npm also works. Use one consistently.

Entry point: index.js

Scripts (package.json):
- start: node index.js
- start:dev: nodemon index.js

---

## Requirements

- Node.js 20 or newer
- Shopify Admin API access token and store domain
- Altegio company/storage IDs and tokens

---

## Project structure
```
.
├── index.js                      # Application entry point (Express server)
├── utils/
│   ├── config.js                 # Env validation and CONFIG aggregation (zod)
│   └── index.js                  # Helpers (formatting, sleep, logs formatting)
├── middleware/
│   ├── baseAuth.middleware.js    # Basic auth guard for internal routes
│   └── waitReady.middleware.js   # Blocks access until cache is warm
├── services/
│   ├── altegio.service.js        # Altegio API client
│   ├── shopify.service.js        # Shopify GraphQL client + inventory ops
│   └── queue2.service.js         # Minimal persistent queue with backoff
├── steps/                        # Request pipeline steps for webhook processing
├── store/
│   ├── cache.manager.js          # In-memory cache, logs storage
│   └── useStore.js               # SKU mapping, preload Shopify inventory
├── views/
│   └── logs.ejs                  # Logs page
└── package.json
```

Note: Earlier docs mentioned queue.service.js; the current implementation lives in services/queue2.service.js.

---

## Setup

1) Install dependencies

- with Yarn
  - yarn install

- with npm
  - npm install

2) Configure environment

Create a .env file in the project root and set the variables listed below. The app validates envs using zod and provides a few fallbacks.

3) Run

- Production-like
  - yarn start
  - or: npm start

- Development (auto-restart with nodemon)
  - yarn start:dev
  - or: npm run start:dev

For a short Ukrainian quickstart guide, see [USAGE-UK.md](USAGE-UK.md).

---

## Environment variables

The utils/config.js file defines and validates environment variables. Required ones must be set; optional ones have defaults or may be omitted.

Server:
- PORT (optional, int) – HTTP port, default 3000
- WARMUP_ON_START (optional, string 'true'|'false') – when 'true', warms cache after start
- SKU_REFRESH_INTERVAL_MS (optional, int) – how often to refresh Shopify SKU cache; default 900000 (15 minutes). Set to 0 to disable.

Altegio:
- ALTEGIO_COMPANY_ID (required, int) – also accepts ALTEGION_COMPANY_ID as fallback
- ALTEGIO_STORAGE_ID (required, int) – also accepts ALTEGION_STORAGE_ID as fallback
- ALTEGIO_TOKEN (required, string) – partner token; also accepts ALTEGION_TOKEN as fallback
- ALTEGIO_USER_TOKEN (required, string) – user token; also accepts ALTEGION_USER_TOKEN as fallback

Shopify:
- SF_API_VERSION (required, string) – e.g., 2025-04
- SF_DOMAIN (required, string) – your-store.myshopify.com
- SF_ADMIN_ACCESS_TOKEN (required, string)
- SF_CONST_LOCATION_ID (required, string) – Shopify Location GID

Security (basic auth for internal routes):
- BASIC_AUTH_USER (optional, string)
- BASIC_AUTH_PASS (optional, string)

Webhook/idempotency/queue:
- IDEMPOTENCY_TTL_MS (optional, int) – default 300000 (5 minutes)
- QUEUE_BACKOFF_BASE_MS (optional, int) – default 1500 ms

---

## Running and usage

Endpoints:
- GET /healthz – returns ok, readiness flag, and cache size
- GET /logs – HTML page with recent logs (basic auth protected)
- GET /db – JSON dump of cache (basic auth protected)
- GET /sku?sku=... – resolves Shopify inventoryItemId by SKU (basic auth protected)
- POST /webhook – main Altegio integration entry

Example webhook payload (shape may vary by resource):
```
{
  "resource": "goods_operations_sale",
  "company_id": 12345,
  "data": {
    "good": { "id": 678 },
    "amount": -2
  }
}
```

Queue behavior:
- Incoming product IDs are added to a persistent Set backed by store/pending-queue.json
- A background interval processes one item at a time with exponential backoff on errors
- Quantities are updated in Shopify for the configured SF_CONST_LOCATION_ID

Warmup:
- If WARMUP_ON_START='true', after startup the service attempts to preload Shopify products/variants into the cache for faster SKU→inventory lookups
- The cache refreshes periodically every SKU_REFRESH_INTERVAL_MS (default 15 minutes) to pick up newly created Shopify variants

Basic auth:
- If BASIC_AUTH_USER and BASIC_AUTH_PASS are set, internal routes (/db, /sku, /logs) require HTTP Basic authentication

---

## Scripts

- yarn start / npm start – start the server
- yarn start:dev / npm run start:dev – start with nodemon for development

---

## Tests

No tests are present in the repository at this time.
- TODO: Add unit tests for utils and services
- TODO: Add integration tests for webhook processing pipeline

---

## Project status and limitations

- No external database; cache is in-memory with minimal disk persistence for the queue
- Single Shopify location supported (via SF_CONST_LOCATION_ID)
- Rate-limit handling is basic; retries and backoff exist in queue2.service.js, but end-to-end robustness may be improved

Planned enhancements (ideas):
- Persist cache in Redis or a database
- Support additional Altegio webhook types
- Improve retry policies (throttled/5xx)
- Multi-tenant support (multiple companies/locations)

---

## License

No license file detected.
- TODO: Add a LICENSE file and specify licensing terms

---

## Author / Support

Originally developed by Frontangel.
For questions or suggestions, you may open an issue in the project’s tracker.
