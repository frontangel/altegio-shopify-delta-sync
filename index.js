import 'dotenv/config';
import express, { json } from 'express';
import { useStore } from './store/useStore.js';
import { RedisManager } from './store/redis.manger.js';
import { waitUntilReady } from './middleware/waitReady.middleware.js';
import { basicAuthMiddleware } from './middleware/baseAuth.middleware.js';
import { useUtils } from './utils/index.js';
import { webhookSecurityMiddleware } from './utils/webhookSecurity.js';
import { validateRulesStep } from './steps/validate-rules.step.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProductIdsStep } from './steps/get-product-ids.step.js';
import { addIdsToQueue } from './services/queue2.service.js';
import redis from './services/redis.js';
import * as ShopifyService from './services/shopify.service.js';
import * as AltegioService from './services/altegio.service.js';

const PORT = process.env.PORT || 3000;
const ALTEGIO_STORAGE_ID = parseInt(process.env.ALTEGIO_STORAGE_ID || '2557508', 10);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(['/', '/sku', '/db', '/logs', '/debug/redis/flush', '/queue', '/queue/processing', '/queue/dead-letter', '/double'], basicAuthMiddleware, waitUntilReady);

app.get('/', async (req, res) => {
  res.render('help')
})

app.get('/healthz', async (req, res) => {
  const { isReady } = useStore();
  const skuCacheSize = await RedisManager.getAllSkuMappingsSize()
  res.json({ ok: true, ready: isReady(), skuCacheSize });
});

app.get('/double', async (req, res) => {
  const doubles = await RedisManager.getDoubles()
  const json = Object.entries(doubles).reduce((acc, [key, value]) => {
    acc[key] = JSON.parse(value);
    return acc
  }, {})
  res.json(json);
})

app.get('/logs', async (req, res) => {
  const {formatedLog} = useUtils();
  const limit = Math.min(Number(req.query.limit) || 100, 100);
  const logs = (await RedisManager.getWebhookLogs(limit)).sort((a, b) => a.timestamp > b.timestamp ? -1 : 1).map(formatedLog);

  const isJson = req.query.json === 'true';

  if (isJson) {
    return res.json(logs);
  }
  res.render('logs', {logs});
});

app.get('/sync/:id', async (req, res) => {
  const sku = req.params.id;
  const quantity = Number(req.query.q)

  const inventoryItemId = await RedisManager.getSkuMapping(sku);
  if (!inventoryItemId) {
    return res.status(404).json({ error: 'SKU not found', sku });
  }

  if (!req.query.q?.trim() || isNaN(quantity)) {
    const inventoryItem = await ShopifyService.getInventoryItemById(inventoryItemId)
    return res.json({inventoryItem})
  }

  // Create a manual sync task instead of directly updating
  const hookId = await RedisManager.setWebhookLogs({
    status: 'waiting',
    type: 'manual_sync',
    resource: 'manual',
    reason: `Manual sync: ${sku} = ${quantity}`,
    json: JSON.stringify({ sku, quantity, inventoryItemId })
  });

  // Add to queue using a fake goodId (we already have the SKU)
  // We'll need to handle this differently in the worker
  await RedisManager.setQueue(hookId, `manual:${sku}:${quantity}:${inventoryItemId}`);

  res.json({
    status: 'ok',
    message: 'Sync task queued',
    hookId,
    sku,
    quantity
  });
})

app.get('/inventory', async (req, res) => {
  const result = await ShopifyService.getInventoryItemById(req.query.id);
  return res.json(result);
})

app.get('/queue', async (req, res) => {
  const [correction, processing, deadLetter] = await Promise.all([
    RedisManager.getQueue(),
    RedisManager.getProcessingQueue(),
    RedisManager.getDeadLetterQueue()
  ]);

  return res.json({
    correction: {
      count: correction.length,
      tasks: correction
    },
    processing: {
      count: processing.length,
      tasks: processing
    },
    deadLetter: {
      count: deadLetter.length,
      tasks: deadLetter
    }
  });
});

app.get('/queue/processing', async (req, res) => {
  const processing = await RedisManager.getProcessingQueue();
  return res.json({ count: processing.length, tasks: processing });
});

app.get('/queue/dead-letter', async (req, res) => {
  const deadLetter = await RedisManager.getDeadLetterQueue();
  return res.json({ count: deadLetter.length, tasks: deadLetter });
});

app.get('/debug/redis/flush', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: 'Forbidden outside DEV mode' });
    }
    await redis.flushall();
    res.json({ status: 'ok', message: 'Redis cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/db', async (req, res) => {
  const [articles, shopifySkuInventory] = await Promise.all([RedisManager.altegioArticleShopifySky(), RedisManager.shopifySkuInventory()])
  return res.json({
    articles,
    shopifySkuInventory
  });
});

app.get('/sku', async (req, res) => {
  const shopifyInventoryId = await RedisManager.getSkuMapping(req.query.id);
  return res.json({shopifyInventoryId});
});

app.post('/webhook', webhookSecurityMiddleware, async (req, res) => {
  const operationRules = {
    goods_operations_sale: {type_id: 1, type: 'Product sales', skipStatus: ['update'], onlyStorageId: ALTEGIO_STORAGE_ID},
    goods_operations_receipt: {type_id: 3, type: 'Product arrival', skipStatus: ['update'], onlyStorageId: ALTEGIO_STORAGE_ID},
    goods_operations_stolen: {type_id: 4, type: 'Product write-off', skipStatus: ['update'], onlyStorageId: ALTEGIO_STORAGE_ID},
    goods_operations_move: {type_id: 0, type: 'Moving products', onlyStorageId: ALTEGIO_STORAGE_ID, onlyStatus: ['create']},
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
      return this.rules[req.body.resource];
    }
  };

  const pipeline = [
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

  const resource = req.body.resource || ''
  const resourceType = req.body.data?.type || ''

  if (ctx.error) {
    const hookId = await RedisManager.setWebhookLogs({...ctx.log, resource, type: resourceType, json: JSON.stringify(req.body)});
    return res.status(400).json({error: true, message: ctx.log.reason, hookId});
  }

  if (ctx.done) {
    const hookId = await RedisManager.setWebhookLogs({...ctx.log, resource, type: resourceType, json: JSON.stringify(req.body)});
    return res.status(200).json({status: ctx.log.status, message: ctx.log.reason, hookId});
  }

  const hookId = await RedisManager.setWebhookLogs({ status: 'waiting', type: resourceType, resource, reason: ctx.state.product_ids.join(), json: JSON.stringify(req.body) });
  await addIdsToQueue(hookId, ...ctx.state.product_ids);

  return res.json({ hookId, ...ctx.state });
});


app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);

  if (process.env.WARMUP_ON_START === 'true') {
    setTimeout(async () => {
      await RedisManager.clearDoubles()
      useStore().getShopifyInventoryIdsBySku()
        .then(() => console.log('Cashing done.'))
        .catch(e => console.warn('Warmup failed:', e?.message || e));
    }, 30000);
  }
});


export default app;
