import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js'
import { CacheManager } from '../store/cache.manager.js';
import { CONFIG } from '../utils/config.js';

const queueSet = new Set();
const retryCounts = new Map();
let isProcessing = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUEUE_FILE = path.join(__dirname, '..', 'store', 'pending-queue.json');

function loadQueueFromDisk() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(id => queueSet.add(id));
      }
    }
  } catch (err) {
    console.warn('⚠️ Unable to load queue from disk:', err.message);
  }
}

function persistQueue() {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify([...queueSet]));
  } catch (err) {
    console.warn('⚠️ Unable to persist queue:', err.message);
  }
}

loadQueueFromDisk();

export function addIdsToQueue(ids) {
  const idArray = Array.isArray(ids) ? ids : [ids]
  idArray.forEach(id => queueSet.add(id))
  persistQueue();
}

export async function processNextId() {
  if (isProcessing || queueSet.size === 0) return;

  isProcessing = true;
  const iterator = queueSet.values();
  const goodId = iterator.next().value;
  queueSet.delete(goodId);
  persistQueue();

  const ctx = {
    altegio_sku: '',
    quantity: null,
    storage_id: CONFIG.altegio.storageId,
  }

  try {
    await handleGoodId(goodId, ctx);
    retryCounts.delete(goodId);
  } catch (err) {
    const nextAttempt = (retryCounts.get(goodId) ?? 0) + 1;
    retryCounts.set(goodId, nextAttempt);

    CacheManager.logWebhook({ status: 'error', reason: err.message, type: 'correction', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
    console.error('❌ Task failed:', err.message);

    const delay = Math.min(30000, CONFIG.queue.backoffBaseMs * Math.pow(2, nextAttempt));
    setTimeout(() => {
      queueSet.add(goodId);
      persistQueue();
    }, delay);
  } finally {
    isProcessing = false;
  }
}

async function handleGoodId(goodId, ctx) {
  const altegioProduct = await AltegioService.fetchProduct(CONFIG.altegio.companyId, goodId)
  ctx.altegio_sku = altegioProduct?.data?.article

  const amount = (altegioProduct?.data?.actual_amounts ?? []).find(a => a.storage_id === CONFIG.altegio.storageId)?.amount;
  ctx.quantity = typeof amount === 'number' ? amount : null;

  if (ctx.quantity === null) {
    throw new Error(`Quantity missing for good ${goodId} and storage ${CONFIG.altegio.storageId}`);
  }

  const inventoryItemId = await CacheManager.inventoryItemIdByAltegioSku(ctx.altegio_sku)
  if (!inventoryItemId) {
    CacheManager.logWebhook({ status: 'skipped', reason: 'Inventory item id not found', type: 'correction', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
    return
  }
  await ShopifyService.setAbsoluteQuantity(inventoryItemId, ctx.quantity, { altegioSku: ctx.altegio_sku, goodId, storageId: CONFIG.altegio.storageId })
  CacheManager.logWebhook({ status: 'success', type: 'correction', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
}

setInterval(processNextId, 2000);
