# 🛒 Altegio → Shopify Sync Service (Production-Ready)

Production-grade synchronization service that receives webhooks from [Altegio](https://altegio.com/) and reliably updates inventory in [Shopify](https://shopify.com).

---

## ✨ Key Features

### 🔐 Reliability & Data Integrity
- ✅ **Atomic Queue Operations** - BRPOPLPUSH pattern prevents task loss on crashes
- ✅ **Idempotency Protection** - Prevents duplicate updates with 24-hour deduplication
- ✅ **Distributed Locking** - Per-SKU locks prevent race conditions in multi-instance deployments
- ✅ **Dead Letter Queue** - Failed tasks preserved for manual inspection and replay
- ✅ **Stale Task Recovery** - Automatic recovery of stuck tasks from processing queue
- ✅ **Consistency Verification** - Optional post-update validation ensures Shopify received correct quantity

### 🚀 Performance & Scalability
- ✅ **Intelligent Retry Logic** - Exponential backoff for network and server errors
- ✅ **Rate Limit Handling** - Adaptive throttling for both Altegio and Shopify APIs
- ✅ **Network Resilience** - Comprehensive retry for transient failures (timeouts, 5xx errors)
- ✅ **Horizontal Scaling Ready** - Distributed locks enable safe multi-worker deployment

### 🔒 Security
- ✅ **Webhook Signature Verification** - HMAC-SHA256 validation (optional)
- ✅ **Basic Auth for Admin Endpoints** - Protected monitoring and debug endpoints
- ✅ **Environment-based Configuration** - All sensitive data in environment variables

### 📊 Observability
- ✅ **Structured Logging** - JSON-formatted logs with context (hookId, workerId, SKU, etc.)
- ✅ **Queue Monitoring Endpoints** - Real-time visibility into queue status
- ✅ **Webhook Logs** - 3-day retention of all webhook events with status tracking
- ✅ **Metrics-Ready** - Designed for integration with Prometheus/Datadog

---

## 📦 Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Altegio   │────────▶│  Webhook     │────────▶│ Redis Queue     │
│   Webhook   │         │  Validation  │         │  (BRPOPLPUSH)   │
└─────────────┘         └──────────────┘         └─────────────────┘
                              │                           │
                              │                           ▼
                              ▼                   ┌─────────────────┐
                        ┌──────────────┐         │ Worker with     │
                        │  Rules       │         │ - Idempotency   │
                        │  Pipeline    │         │ - Locking       │
                        └──────────────┘         │ - Retry Logic   │
                                                  └─────────────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────────┐
                                                  │ Shopify API     │
                                                  │ + Verification  │
                                                  └─────────────────┘
```

### Queue Architecture

**Correction Queue** → **Processing Queue** → **Completion/Dead Letter**

- Tasks atomically moved between queues using `BRPOPLPUSH`
- Processing queue monitored for stale tasks (60s threshold)
- Failed tasks (after 3 retries) moved to dead letter queue
- Unique worker IDs track task ownership

---

## ⚙️ Installation

### 1. Clone and Install

```bash
git clone https://github.com/your-repo/altegio-shopify-sync.git
cd altegio-shopify-sync
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Required Environment Variables

```env
# Server
PORT=3000
NODE_ENV=production

# Redis (required)
REDIS_URL=redis://localhost:6379

# Shopify (required)
SF_API_VERSION=2025-04
SF_DOMAIN=your-store.myshopify.com
SF_ADMIN_ACCESS_TOKEN=shpat_xxxxx
SF_CONST_LOCATION_ID=gid://shopify/Location/123456789

# Altegio (required)
ALTEGIO_TOKEN=your_partner_token
ALTEGIO_USER_TOKEN=your_user_token
ALTEGIO_COMPANY_ID=1275575
ALTEGIO_STORAGE_ID=2557508

# Security (recommended for production)
WEBHOOK_SECURITY_ENABLED=true
ALTEGIO_WEBHOOK_SECRET=your_webhook_secret

BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=strong_password_here

# Features
WARMUP_ON_START=true
ENABLE_SHOPIFY_VERIFICATION=true  # Post-update consistency check
```

### 4. Start Server

```bash
npm start
```

For development with hot reload:
```bash
npm run start:dev
```

---

## 📥 API Endpoints

### Public Endpoints

#### `POST /webhook`
Receives webhooks from Altegio

**Supported Resources:**
- `goods_operations_sale` - Product sales
- `goods_operations_receipt` - Product arrivals
- `goods_operations_stolen` - Product write-offs
- `goods_operations_move` - Product movements
- `record` - Booking records (with goods_transactions)

**Headers (if security enabled):**
```
X-Altegio-Signature: <hmac-sha256-signature>
```

**Response:**
```json
{
  "hookId": "uuid",
  "state": {
    "product_ids": [12345, 67890]
  }
}
```

#### `GET /healthz`
Health check endpoint

**Response:**
```json
{
  "ok": true,
  "ready": true,
  "skuCacheSize": 1234
}
```

---

### Protected Endpoints (Basic Auth Required)

#### `GET /queue`
View all queues status

**Response:**
```json
{
  "correction": {
    "count": 5,
    "tasks": [...]
  },
  "processing": {
    "count": 2,
    "tasks": [...]
  },
  "deadLetter": {
    "count": 1,
    "tasks": [...]
  }
}
```

#### `GET /queue/processing`
View tasks currently being processed

#### `GET /queue/dead-letter`
View failed tasks in dead letter queue

#### `GET /logs?limit=100&json=true`
View webhook processing logs

#### `GET /sync/:sku?q=<quantity>`
Manual inventory sync (now uses queue for consistency)

**Example:**
```bash
curl -u admin:password "https://your-app.com/sync/ABC123?q=10"
```

#### `GET /double`
View SKUs mapped to multiple Shopify inventory items (potential issues)

#### `GET /db`
View cached SKU mappings

#### `GET /debug/redis/flush` (development only)
Clear all Redis data

---

## 🔄 Synchronization Flow

### Webhook Processing

1. **Webhook Received** → Signature verification (if enabled)
2. **Rule Validation** → Check resource type, status, storage_id
3. **Product ID Extraction** → Extract affected product IDs
4. **Queue Task Creation** → Add to correction queue with timestamp
5. **Return 200 OK** → Webhook acknowledged immediately

### Worker Processing

1. **Atomic Dequeue** → `BRPOPLPUSH` moves task to processing queue
2. **Idempotency Check** → Skip if already processed (24h cache)
3. **Fetch from Altegio** → Get current stock with retry logic
4. **Acquire Lock** → Per-SKU distributed lock (30s TTL)
5. **Map SKU** → Lookup Shopify inventoryItemId from Redis cache
6. **Update Shopify** → Set absolute quantity with retry
7. **Verify (optional)** → Confirm Shopify has correct quantity
8. **Mark Complete** → Set idempotency key, remove from processing queue
9. **Release Lock** → Free SKU for other workers

### Error Handling

- **Retry 1-3:** Task re-queued to correction queue
- **After 3 failures:** Task moved to dead letter queue
- **Stale tasks:** Auto-recovered after 60 seconds in processing queue

---

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Run Unit Tests
```bash
npm run test:unit
```

### Run Integration Tests
```bash
npm run test:integration
```

### Watch Mode
```bash
npm run test:watch
```

### Test Coverage
Tests cover:
- ✅ BRPOPLPUSH atomic operations
- ✅ Idempotency protection
- ✅ Distributed locking
- ✅ Retry logic
- ✅ Dead letter queue
- ✅ Stale task recovery
- ✅ Webhook validation
- ✅ API endpoints

---

## 🚀 Production Deployment

### Recommended Setup

1. **Redis:** Persistent storage (AOF or RDB enabled)
2. **Multiple Workers:** Safe to run 2-5 instances with load balancer
3. **Monitoring:** Configure alerts for:
   - Dead letter queue size > 10
   - Processing queue size > 50
   - Stale task recovery events
   - Verification failures

### Environment Configuration

```env
NODE_ENV=production
WEBHOOK_SECURITY_ENABLED=true
ENABLE_SHOPIFY_VERIFICATION=true
```

### Docker Example

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

### Health Check

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

---

## 📊 Monitoring

### Key Metrics to Track

- **Queue Depth:** `GET /queue` → `correction.count`
- **Processing Queue Size:** `GET /queue/processing` → `count`
- **Dead Letter Size:** `GET /queue/dead-letter` → `count`
- **Webhook Logs:** `GET /logs?json=true`

### Alerting Recommendations

| Metric | Threshold | Action |
|--------|-----------|--------|
| Dead Letter > 10 | Critical | Investigate failed tasks |
| Processing > 50 | Warning | Check worker performance |
| Correction > 500 | Warning | Possible backlog |
| Verification failures | Any | Check Shopify API status |

---

## 🔧 Troubleshooting

### Task Stuck in Processing Queue

**Symptom:** Tasks remain in processing queue for >60 seconds

**Solution:** Stale task recovery runs automatically every 60 seconds. Check logs for:
```
♻️ Recovered 3 stale tasks from processing queue
```

### Duplicate Updates

**Symptom:** Same product updated multiple times

**Solution:** Idempotency is enabled by default. Check if:
- Worker crashed before setting idempotency key
- 24-hour TTL expired (increase `IDEMPOTENCY_TTL` in redis.manger.js)

### Verification Failures

**Symptom:** Logs show "Verification failed"

**Possible Causes:**
1. Shopify API delayed propagation (normal, retries will fix)
2. Multiple locations configured (only one location supported currently)
3. Network timeout during verification

**Disable verification temporarily:**
```env
ENABLE_SHOPIFY_VERIFICATION=false
```

### Redis Connection Lost

**Symptom:** "⏳ Waiting for Redis..."

**Solution:**
- Check `REDIS_URL` is correct
- Ensure Redis is running and accessible
- Check network connectivity

### Rate Limiting

**Symptom:** "Shopify THROTTLED" or "Altegio retry"

**Solution:**
- System automatically handles rate limits with exponential backoff
- Check for other API clients consuming quota
- Consider reducing concurrent workers

---

## 🗂️ Project Structure

```
.
├── index.js                  # Express app entry point
├── services/
│   ├── altegio.service.js    # Altegio API with retry logic
│   ├── shopify.service.js    # Shopify GraphQL with throttle handling
│   ├── queue2.service.js     # Worker with idempotency & locking
│   └── redis.js              # Redis connection management
├── store/
│   ├── redis.manger.js       # Queue, locks, idempotency operations
│   ├── useStore.js           # SKU caching logic
│   └── cache.manager.js      # In-memory cache (legacy)
├── steps/
│   ├── validate-rules.step.js   # Webhook rule validation
│   └── get-product-ids.step.js  # Product ID extraction
├── middleware/
│   ├── baseAuth.middleware.js    # HTTP Basic Auth
│   └── waitReady.middleware.js   # Cache warmup guard
├── utils/
│   ├── index.js                 # Utilities (sleep, formatting)
│   └── webhookSecurity.js       # HMAC signature verification
├── tests/
│   ├── queue.test.js            # Unit tests for queue operations
│   └── integration.test.js      # Integration tests
└── views/
    ├── help.ejs                 # API documentation page
    └── logs.ejs                 # Webhook logs UI
```

---

## 🆕 Recent Improvements (v2.0)

### Critical Fixes
- ✅ **Atomic Queue Operations:** BRPOPLPUSH prevents data loss on crashes
- ✅ **Idempotency:** 24-hour deduplication prevents duplicate updates
- ✅ **Distributed Locks:** Safe for horizontal scaling
- ✅ **Retry Logic:** Exponential backoff for network/server errors
- ✅ **Dead Letter Queue:** Failed tasks preserved for inspection

### New Features
- ✅ **Consistency Verification:** Optional post-update validation
- ✅ **Webhook Security:** HMAC-SHA256 signature verification
- ✅ **Queue Monitoring:** Real-time queue status endpoints
- ✅ **Stale Task Recovery:** Auto-recovery of stuck tasks
- ✅ **Environment Configuration:** All hardcoded values externalized

### Breaking Changes
- Manual sync endpoint `/sync/:id` now uses queue (async processing)
- Redis BRPOPLPUSH requires Redis 2.2.0+
- Environment variables `ALTEGIO_COMPANY_ID` and `ALTEGIO_STORAGE_ID` required

---

## 📌 Migration from v1.0

1. Update environment variables:
```bash
# Add new required variables
ALTEGIO_COMPANY_ID=your_company_id
ALTEGIO_STORAGE_ID=your_storage_id
```

2. Clear existing queues (one-time):
```bash
redis-cli
> DEL queue:correction
> DEL queue:processing
```

3. Restart application:
```bash
npm start
```

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`npm test`)
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open Pull Request

---

## 📝 License

MIT License - see LICENSE file for details

---

## 👤 Author

Developed by **Frontangel**

- Telegram: [@frontangel](https://t.me/frontangel)
- GitHub Issues: [Report a bug](https://github.com/frontangel/altegio-shopify-delta-sync/issues)

---

## 📚 Additional Resources

- [Altegio API Documentation](https://api.alteg.io/docs/)
- [Shopify GraphQL Admin API](https://shopify.dev/api/admin-graphql)
- [Redis BRPOPLPUSH](https://redis.io/commands/brpoplpush/)
- [Production Best Practices](./docs/production-best-practices.md) (coming soon)

---

## ⚠️ Known Limitations

- **Single Location:** Only updates inventory for one Shopify location
- **Cache Staleness:** New Shopify products require server restart (automatic refresh planned for v2.1)
- **No Reconciliation:** Manual reconciliation required for detecting drift (automated reconciliation planned)

---

**Production-Ready:** This version has passed comprehensive testing and includes all critical fixes for data consistency.

**Upgrade Recommendation:** If using v1.0, upgrade immediately to prevent data loss and race conditions.
