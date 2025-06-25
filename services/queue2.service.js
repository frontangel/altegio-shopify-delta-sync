import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js'
import { useStore } from '../store/useStore.js';
import { CacheManager } from '../store/cache.manager.js';

const queueSet = new Set();
let isProcessing = false;

const { getAltegioArticleById } = useStore()

export function addIdsToQueue(ids) {
  const idArray = Array.isArray(ids) ? ids : [ids]
  idArray.forEach(id => queueSet.add(id))
}

export async function processNextId() {
  if (isProcessing || queueSet.size === 0) return;

  isProcessing = true;
  const iterator = queueSet.values();
  const goodId = iterator.next().value;
  queueSet.delete(goodId);

  const ctx = {
    altegio_sku: '',
    quantity: null
  }

  try {
    const altegioProduct = await AltegioService.fetchProduct(1275575, goodId)
    ctx.altegio_sku = altegioProduct?.data?.article
    ctx.quantity = altegioProduct.data.actual_amounts.find(a => a.storage_id === 2557508)?.amount;

    const inventoryItemId = await CacheManager.inventoryItemIdByAltegioSku(ctx.altegio_sku)
    if (!inventoryItemId) {
      CacheManager.logWebhook({ status: 'skipped', reason: 'Inventory item id not found', type: 'correction', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
      isProcessing = false;
      return
    }
    await ShopifyService.setAbsoluteQuantity(inventoryItemId, ctx.quantity)
    CacheManager.logWebhook({ status: 'success', type: 'correction', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
  } catch (err) {
    CacheManager.logWebhook({ status: 'error', reason: err.message, type: 'correction', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
    console.error('❌ Task failed:', err.message);
  } finally {
    isProcessing = false;
  }
}

setInterval(processNextId, 2000);
