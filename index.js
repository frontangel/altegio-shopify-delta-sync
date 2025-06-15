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

app.use(['/sku', '/db'], basicAuthMiddleware, waitUntilReady);

app.get('/db', async (req, res) => {
  return res.json({
    articles: CacheManager.altegioArticleShopifySky(),
    shopifySkuInventory: CacheManager.shopifySkuInventory()
  })
})

app.get('/sku', async (req, res) => {
  const shopifyInventoryId = CacheManager.inventoryItemIdByAltegioSku(req.query.sku)
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

  if (!rule) return res.json({ message: 'ok' });

  const { type_id, type, storage, amount: rawAmount, good } = data || {};
  const storageId = storage?.id;
  let amount;

  if (rule.type_id !== type_id || rule.type !== type) {
    return res.json({ message: 'ok' });
  }

  if (rule.onlyStorageId && rule.onlyStorageId !== storageId) {
    return res.json({ message: 'ok' });
  }
  if (rule.onlyStatus && rule.onlyStatus !== status) {
    return res.json({ message: 'ok' });
  }

  if (status === 'create') amount = rawAmount;
  else if (status === 'delete') amount = -rawAmount;

  if (!amount || typeof amount !== 'number') {
    return res.json({ message: 'ok' });
  }

  const sku_from_altegio = await getAltegioArticleById(company_id, good?.id);
  const inventoryItemId = CacheManager.inventoryItemIdByAltegioSku(sku_from_altegio);
  addTask(() => mutateInventoryQuantity(inventoryItemId, amount));
  return res.json({ sku_from_altegio, inventoryItemId, amount });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    getShopifyInventoryIdsBySku().then(() => console.log('Cashing done.'))
  });
}

export default app
