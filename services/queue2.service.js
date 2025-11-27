import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js'
import { RedisManager } from '../store/redis.manger.js';

export async function addIdsToQueue(hookId, ids) {
  const idArray = Array.isArray(ids) ? ids : [ids]

  for (const id of idArray) {
    await RedisManager.setQueue(hookId, id)
  }
}


async function workerLoop() {
  while (true) {
    const task = await RedisManager.nextQueue();
    if (!task) {
      await new Promise(r => setTimeout(r, 3000)); // пауза коли черга пуста
      continue;
    }

    try {
      await processNextId(task);
    } catch (err) {
      if (task.retry >= 1) {
        console.log("❌ Task failed twice, dropping:", task.hookId);
        continue; // видаляємо повністю
      }

      console.log("⚠️ Task failed, retrying:", task.hookId);
      await RedisManager.retryQueue(task);
    }
  }
}


export async function processNextId(task) {
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
      await RedisManager.updateLogWebhook(hookId, { status: 'error', reason: 'Invalid Altegio product response', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity })
      return
    }

    ctx.altegio_sku = data.article

    const amounts = data.actual_amounts || [];
    ctx.quantity = amounts.find(a => a.storage_id === 2557508)?.amount ?? 0;


    // --- 2) inventory item id ---
    const inventoryItemId = await RedisManager.getSkuMapping(ctx.altegio_sku)
    if (!inventoryItemId) {
      await RedisManager.updateLogWebhook(hookId ,{ status: 'skipped', reason: 'Inventory item id not found', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
      return
    }

    // --- 3) Shopify update ---
    await ShopifyService.setAbsoluteQuantity(inventoryItemId, ctx.quantity)
    await RedisManager.updateLogWebhook(hookId, { status: 'success', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });

  } catch (err) {
    await RedisManager.updateLogWebhook(hookId, { status: 'error', reason: err.message, altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
    throw err;
  }
}

workerLoop().then(() => console.log('Queue processing started.'));

