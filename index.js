import 'dotenv/config';
import express from 'express';
import { useStore } from './store/useStore.js';
import { CacheManager } from './store/cache.manager.js';
import { waitUntilReady } from './middleware/waitReady.middleware.js';
import { basicAuthMiddleware } from './middleware/baseAuth.middleware.js';
import { useUtils } from './utils/index.js';
import { validateRulesStep } from './steps/validate-rules.step.js';
import { validateWebhookPayloadStep } from './steps/validate-webhook-payload.step.js';
import { enforceIdempotencyStep } from './steps/enforce-idempotency.step.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProductIdsStep } from './steps/get-product-ids.step.js';
import { addIdsToQueue } from './services/queue2.service.js';
import { CONFIG } from './utils/config.js';

const PORT = CONFIG.server.port;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(['/sku', '/db', '/logs'], basicAuthMiddleware, waitUntilReady);

app.get('/healthz', (req, res) => {
  const { isReady } = useStore();
  res.json({ ok: true, ready: isReady(), skuCacheSize: CacheManager.skuMapper.size });
});

app.get('/logs', (req, res) => {
  const {formatedLog} = useUtils();
  const logs = CacheManager.getWebhookLogs().map(formatedLog);
  res.render('logs', {logs});
});

app.get('/db', async (req, res) => {
  return res.json({
    articles: CacheManager.altegioArticleShopifySky(),
    shopifySkuInventory: CacheManager.shopifySkuInventory()
  });
});

app.get('/sku', async (req, res) => {
  const shopifyInventoryId = await CacheManager.inventoryItemIdByAltegioSku(req.query.sku);
  return res.json({shopifyInventoryId});
});

app.post('/webhook', async (req, res) => {
  const operationRules = {
    goods_operations_sale: {type_id: 1, type: 'Product sales', skipStatus: ['update'], onlyStorageId: CONFIG.altegio.storageId},
    goods_operations_receipt: {type_id: 3, type: 'Product arrival', skipStatus: ['update'], onlyStorageId: CONFIG.altegio.storageId},
    goods_operations_stolen: {type_id: 4, type: 'Product write-off', skipStatus: ['update'], onlyStorageId: CONFIG.altegio.storageId},
    goods_operations_move: {type_id: 0, type: 'Moving products', onlyStorageId: CONFIG.altegio.storageId, onlyStatus: ['create']},
    record: {onlyStatus: 'update', onlyPaidFull: 1}
  };

  const ctx = {
    rules: operationRules,
    input: req.body,
    state: {
      product_ids: []
    },
    log: {
      status: '',
      reason: '',
      type: 'hook',
    },
    error: false,
    done: false,
    get rule() {
      return this.rules[this.input?.resource];
    }
  };

  const pipeline = [
    validateWebhookPayloadStep,
    enforceIdempotencyStep,
    validateRulesStep,
    getProductIdsStep
  ];

  for (const step of pipeline) {
    try {
      await step(ctx);
      if (ctx.done || ctx.error) break;
    } catch (e) {
      ctx.error = true;
      ctx.log.status = 'error';
      ctx.log.reason = e.message || 'Unhandled exception';
      break;
    }
  }

  if (ctx.error) {
    CacheManager.logWebhook({...ctx.log, type: 'hook', json: JSON.stringify(req.body), correlation_id: ctx.correlationId});
    return res.status(400).json({error: true, message: ctx.log.reason});
  }

  if (ctx.done) {
    CacheManager.logWebhook({...ctx.log, type: 'hook', json: JSON.stringify(req.body), correlation_id: ctx.correlationId});
    return res.status(200).json({status: ctx.log.status, message: ctx.log.reason});
  }

  CacheManager.logWebhook({status: 'success', type: 'hook', json: JSON.stringify(req.body), correlation_id: ctx.correlationId});
  addIdsToQueue(ctx.state.product_ids);

  return res.json(ctx.state);
});


app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);

  const store = useStore();

  if (CONFIG.server.warmupOnStart) {
    setTimeout(() => {
      store.getShopifyInventoryIdsBySku()
        .then(() => console.log('Cashing done.'))
        .catch(e => console.warn('Warmup failed:', e?.message || e));
    }, 30000);
  }

  if (CONFIG.server.refreshIntervalMs > 0) {
    setInterval(() => {
      store
        .getShopifyInventoryIdsBySku()
        .then(() => console.log(`[Warmup] Refreshed SKU cache; size=${CacheManager.skuMapper.size}`))
        .catch(e => console.warn('[Warmup] Refresh failed:', e?.message || e));
    }, CONFIG.server.refreshIntervalMs);
  }
});


export default app;
