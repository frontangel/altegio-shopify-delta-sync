import 'dotenv/config';
import express from 'express';
import { useStore } from './store/useStore.js';
import { CacheManager } from './store/cache.manager.js';
import { mutateInventoryQuantity } from './services/shopify.service.js'
import { addTask } from './services/queue.service.js';
import { waitUntilReady } from './middleware/waitReady.middleware.js';
import { basicAuthMiddleware } from './middleware/baseAuth.middleware.js';


const { getShopifyInventoryIdsBySku, getAltegioArticleById } = useStore()
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

app.use(['/sku', '/db', '/logs'], basicAuthMiddleware, waitUntilReady);

app.get('/logs', (req, res) => {
  res.json(CacheManager.getWebhookLogs());
});

app.get('/db', async (req, res) => {
  return res.json({
    articles: CacheManager.altegioArticleShopifySky(),
    shopifySkuInventory: CacheManager.shopifySkuInventory()
  })
})

app.get('/sku', async (req, res) => {
  const shopifyInventoryId = await CacheManager.inventoryItemIdByAltegioSku(req.query.sku)
  return res.json({ shopifyInventoryId })
});

app.post('/webhook', waitUntilReady, async (req, res) => {
  const operationRules = {
    goods_operations_sale: {
      type_id: 1,
      type: 'Product sales',
    },
    goods_operations_receipt: {
      type_id: 3,
      type: 'Product arrival',
    },
    goods_operations_stolen: {
      type_id: 4,
      type: 'Product write-off',
    },
    goods_operations_move: {
      type_id: 0,
      type: 'Moving products',
      onlyStorageId: 2557508,
      onlyStatus: 'create'
    }
  };

  const { resource, status, company_id, data } = req.body;
  const rule = operationRules[resource];
  const { type_id, type, storage, amount: rawAmount, good } = data || {};

  if (!rule) {
    const logRule = {
      status: 'skipped',
      goodId: good?.id,
      resource,
      reason: 'Skip by rule',
    }
    CacheManager.logWebhook(logRule);
    return res.json(logRule);
  }


  const storageId = storage?.id;
  let amount;

  if (rule.type_id !== type_id || rule.type !== type) {
    const logType = {
      status: 'skipped',
      goodId: good?.id,
      type,
      type_id,
      reason: 'Skip by type',
    }
    CacheManager.logWebhook(logType);
    return res.json(logType);
  }

  if (rule.onlyStorageId && rule.onlyStorageId !== storageId) {
    const logStorage = {
      status: 'skipped',
      goodId: good?.id,
      onlyStorageId: rule.onlyStorageId,
      reason: 'Skip by storageId',
    }
    CacheManager.logWebhook(logStorage);
    return res.json(logStorage);
  }
  if (rule.onlyStatus && rule.onlyStatus !== status) {
    const logStatus = {
      status: 'skipped',
      goodId: good?.id,
      onlyStatus: rule.onlyStatus,
      reason: 'Skip by status',
    }
    CacheManager.logWebhook(logStatus);
    return res.json(logStatus);
  }

  if (status === 'create') amount = rawAmount;
  else if (status === 'delete') amount = -rawAmount;

  if (!amount || typeof amount !== 'number') {
    const logAmount = {
      status: 'skipped',
      goodId: good?.id,
      amount,
      reason: 'Skip by amount',
    }
    CacheManager.logWebhook(logAmount);
    return res.json(logAmount);
  }

  const sku_from_altegio = await getAltegioArticleById(company_id, good?.id);
  const inventoryItemId = await CacheManager.inventoryItemIdByAltegioSku(sku_from_altegio);

  if (!inventoryItemId) {
    const logInventoryItemId = {
      status: 'skipped',
      goodId: good?.id,
      inventoryItemId,
      reason: 'Skip by inventory item id',
    }
    CacheManager.logWebhook(logInventoryItemId);
    return res.json(logInventoryItemId);
  }

  addTask(() => mutateInventoryQuantity(inventoryItemId, amount));

  const logAdded = {
    status: 'added',
    goodId: good?.id,
    inventoryItemId,
    amount,
    json: JSON.stringify(req.body)
  }
  CacheManager.logWebhook(logAdded);
  return res.json(logAdded);
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    getShopifyInventoryIdsBySku().then(() => console.log('Cashing done.'))
  });
}

export default app
