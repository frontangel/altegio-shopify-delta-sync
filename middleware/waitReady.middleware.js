import { useStore } from '../store/useStore.js';
const { getShopifyInventoryIdsBySku, isReady } = useStore()

export async function waitUntilReady(req, res, next) {
  if (isReady()) return next()

  console.log('⏳ Очікуємо завершення мапінгу SKU…');
  try {
    await getShopifyInventoryIdsBySku();
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'SKU Mapping failed', detail: err.message });
  }
}
