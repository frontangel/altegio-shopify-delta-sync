import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js'
import { CacheManager } from '../store/cache.manager.js';

const queue = [];
let isProcessing = false;

export function addIdsToQueue(data) {
  const { hookId, product_ids } = data;
  const idArray = Array.isArray(product_ids) ? product_ids : [product_ids]
  for (const id of idArray) {
    queue.push({ hookId, id, retry: 0 });
  }
}

export async function processNextId() {
  if (isProcessing) return;
  if (queue.length === 0) return;

  isProcessing = true;

  const task = queue.shift();
  const hookId = task.hookId;
  const goodId = task.id;

  const ctx = {
    altegio_sku: '',
    quantity: null
  }

  try {
    // --- 1) Запит у Altegio ---
    const productRes = await AltegioService.fetchProduct(1275575, goodId);
    const data = productRes?.data;
    if (!data) {
      CacheManager.updateLogById({ _id: hookId, status: 'error', reason: 'Invalid Altegio product response', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
      isProcessing = false;
      return
    }

    ctx.altegio_sku = data.article

    const amounts = data.actual_amounts || [];
    ctx.quantity = amounts.find(a => a.storage_id === 2557508)?.amount ?? 0;


    // --- 2) inventory item id ---
    const inventoryItemId = await CacheManager.inventoryItemIdByAltegioSku(ctx.altegio_sku)
    if (!inventoryItemId) {
      CacheManager.updateLogById({ _id: hookId, status: 'skipped', reason: 'Inventory item id not found', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
      isProcessing = false;
      return
    }


    // --- 3) Shopify update ---
    await ShopifyService.setAbsoluteQuantity(inventoryItemId, ctx.quantity)
    CacheManager.updateLogById({ _id: hookId, status: 'success', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });

  } catch (err) {
    CacheManager.updateLogById({ _id: hookId, status: 'error', reason: err.message, altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
    console.error('❌ Task failed:', err.message);

    if (task.retry < 1) {
      task.retry++;
      queue.push(task);
    }
  } finally {
    isProcessing = false;
  }
}

async function loop() {
  try {
    await processNextId();
  } finally {
    setTimeout(loop, 250);
  }
}

loop().then(() => console.log('Queue processing started.'));

