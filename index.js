import 'dotenv/config';
import express from 'express';
import { useStore } from './store/useStore.js';
import { CacheManager } from './store/cache.manager.js';
import { mutateInventoryQuantity } from './services/shopify.service.js'
import { addTask } from './services/queue.service.js';
import { waitUntilReady } from './middleware/waitReady.middleware.js';
import { basicAuthMiddleware } from './middleware/baseAuth.middleware.js';


const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

const { getShopifyInventoryIdsBySku, getAltegioArticleById, isReady } = useStore()

// ⏱ middleware підключається перед усіма потрібними ендпоінтами
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
  const { resource, status } = req.body;
  const { type_id, type, storage } = req.body.data;
  const storageId = storage?.id

  const allowedActions = ['goods_operations_move', 'goods_operations_stolen', 'goods_operations_receipt', 'goods_operations_sale']
  if (!allowedActions.includes(resource)) return res.json({ message: 'ok' });

  let amount
  if (resource === 'goods_operations_sale') {
    if (type_id !== 1 || type !== 'Product sales') return res.json({ message: 'ok' });
    switch (status) {
      case 'create': amount = req.body.data?.amount
        break
      case 'delete': amount = -req.body.data?.amount
        break
    }
  }

  if (resource === 'goods_operations_receipt') {
    if (type_id !== 3 || type !== 'Product arrival') return res.json({ message: 'ok' });
    switch (status) {
      case 'create': amount = req.body.data?.amount
        break
      case 'delete': amount = -req.body.data?.amount
        break
    }
  }

  if (resource === 'goods_operations_stolen') {
    if (type_id !== 4 || type !== 'Product write-off') return res.json({ message: 'ok' });
    switch (status) {
      case 'create': amount = req.body.data?.amount
        break
      case 'delete': amount = -req.body.data?.amount
        break
    }
  }

  if (resource === 'goods_operations_move' && storageId === 2557508 && status === 'create') {
    if (type_id !== 0 || type !== 'Moving products') return res.json({ message: 'ok' });
    amount = req.body.data?.amount
  }

  if (!amount) return res.json({ message: 'ok' });

  const sku_from_altegio = await getAltegioArticleById(req.body.company_id, req.body.data?.good?.id)
  const inventoryItemId = CacheManager.inventoryItemIdByAltegioSku(sku_from_altegio)
  addTask(() => mutateInventoryQuantity(inventoryItemId, amount))
  return res.json({ sku_from_altegio, inventoryItemId, amount })
})

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    getShopifyInventoryIdsBySku().then(() => console.log('Cashing done.'))
  });
}
export default app;
