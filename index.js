import 'dotenv/config';
import express from 'express';
import { useStore } from './store/useStore.js';
import { CacheManager } from './store/cache.manager.js';
import { mutateInventoryQuantity } from './services/shopify.service.js'
import { addTask } from './services/queue.service.js';


const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

const { getShopifyInventoryIdsBySku, getAltegioArticleById, isReady } = useStore()

async function waitUntilReady(req, res, next) {
  if (isReady()) return next()

  console.log('⏳ Очікуємо завершення мапінгу SKU…');
  try {
    await getShopifyInventoryIdsBySku();
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'SKU Mapping failed', detail: err.message });
  }
}

// ⏱ middleware підключається перед усіма потрібними ендпоінтами
app.use(['/sku', '/webhook', '/db'], waitUntilReady);

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

app.post('/webhook', async (req, res) => {
  const resource = req.body.resource;

  switch (resource) {
    case 'goods_operations_sale': {
      const sku_from_altegio = await getAltegioArticleById(req.body.company_id, req.body.data?.good?.id)
      const inventoryItemId = CacheManager.inventoryItemIdByAltegioSku(sku_from_altegio)
      const amount = req.body.data?.amount
      addTask(() => mutateInventoryQuantity(inventoryItemId, amount))
      return res.json({ sku_from_altegio, inventoryItemId, amount })
    }
    default:
      console.log(resource);
      break;
  }
  res.json(req.body);
})

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    getShopifyInventoryIdsBySku().then(() => console.log('Cashing done.'))
  });
}
export default app;
