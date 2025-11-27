import 'dotenv/config';
import express, { json } from 'express';
import { useStore } from './store/useStore.js';
import { RedisManager } from './store/redis.manger.js';
import { waitUntilReady } from './middleware/waitReady.middleware.js';
import { basicAuthMiddleware } from './middleware/baseAuth.middleware.js';
import { useUtils } from './utils/index.js';
import { validateRulesStep } from './steps/validate-rules.step.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProductIdsStep } from './steps/get-product-ids.step.js';
import { addIdsToQueue } from './services/queue2.service.js';
import { redis } from './services/redis.js';
import * as ShopifyService from './services/shopify.service.js';
import * as AltegioService from './services/altegio.service.js';

const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(['/', '/sku', '/db', '/logs', '/debug/redis/flush', '/queue', '/double'], basicAuthMiddleware, waitUntilReady);

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
  if (isNaN(quantity)) {
    const inventoryItem = await ShopifyService.getInventoryItemById(inventoryItemId)
    return res.json({inventoryItem})
  }

  await new Promise(r => setTimeout(r, 1000));
  const inventoryItem = await ShopifyService.getInventoryItemById(inventoryItemId)
  await ShopifyService.setAbsoluteQuantity(inventoryItemId, quantity)
  res.json({status: 'ok', message: 'Sync started', inventoryItem });
})

app.get('/inventory', async (req, res) => {
  const result = await ShopifyService.getInventoryItemById(req.query.id);
  return res.json(result);
})

app.get('/queue', async (req, res) => {
  const logs = await RedisManager.getQueue();
  return res.json(logs);
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

app.post('/webhook', async (req, res) => {
  const operationRules = {
    goods_operations_sale: {type_id: 1, type: 'Product sales', skipStatus: ['update'], onlyStorageId: 2557508},
    goods_operations_receipt: {type_id: 3, type: 'Product arrival', skipStatus: ['update'], onlyStorageId: 2557508},
    goods_operations_stolen: {type_id: 4, type: 'Product write-off', skipStatus: ['update'], onlyStorageId: 2557508},
    goods_operations_move: {type_id: 0, type: 'Moving products', onlyStorageId: 2557508, onlyStatus: ['create']},
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
