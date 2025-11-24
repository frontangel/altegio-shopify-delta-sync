import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js'
import { CacheManager } from '../store/cache.manager.js';
import { CONFIG } from '../utils/config.js';
import { getRedisClient, redisQueueAvailable } from '../store/redis.client.js';

const queueSet = new Set();
const retryCounts = new Map();
let isProcessing = false;

const redis = getRedisClient();
const redisKeys = {
  set: `${CONFIG.queue.redisNamespace}:queued`,
  pending: `${CONFIG.queue.redisNamespace}:pending`,
  processing: `${CONFIG.queue.redisNamespace}:processing`,
};

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

async function pullNextId() {
  if (redisQueueAvailable()) {
    try {
      const goodId = await redis.rpoplpush(redisKeys.pending, redisKeys.processing);
      if (!goodId) return { goodId: null, usingRedis: true };
      return { goodId, usingRedis: true };
    } catch (err) {
      console.warn(`⚠️ Unable to pull from Redis queue: ${err.message}`);
    }
  }

  if (queueSet.size === 0) {
    return { goodId: null, usingRedis: false };
  }

  const iterator = queueSet.values();
  const goodId = iterator.next().value;
  queueSet.delete(goodId);
  persistQueue();
  return { goodId, usingRedis: false };
}

async function finalizeSuccess(goodId, usingRedis) {
  if (usingRedis && redisQueueAvailable()) {
    try {
      await redis.multi().lrem(redisKeys.processing, 0, goodId).srem(redisKeys.set, goodId).exec();
      return;
    } catch (err) {
      console.warn(`⚠️ Unable to finalize Redis task ${goodId}: ${err.message}`);
    }
  }

  queueSet.delete(goodId);
  persistQueue();
}

function scheduleRetry(goodId, delay, usingRedis) {
  setTimeout(async () => {
    if (usingRedis && redisQueueAvailable()) {
      try {
        await redis.lrem(redisKeys.processing, 0, goodId);
        await redis.rpush(redisKeys.pending, goodId);
        return;
      } catch (err) {
        console.warn(`⚠️ Unable to requeue ${goodId} in Redis: ${err.message}`);
      }
    }

    queueSet.add(goodId);
    persistQueue();
  }, delay);
}

export async function addIdsToQueue(ids) {
  const idArray = Array.isArray(ids) ? ids : [ids];

  if (redisQueueAvailable()) {
    for (const id of idArray) {
      try {
        const alreadyQueued = await redis.sismember(redisKeys.set, id);
        if (alreadyQueued) continue;
        await redis.multi().sadd(redisKeys.set, id).rpush(redisKeys.pending, id).exec();
      } catch (err) {
        console.warn(`⚠️ Failed to enqueue ${id} in Redis, falling back to disk: ${err.message}`);
        queueSet.add(id);
      }
    }
    if (!redisQueueAvailable()) {
      persistQueue();
    }
    return;
  }

  idArray.forEach((id) => queueSet.add(id));
  persistQueue();
}

export async function processNextId() {
  if (isProcessing) return;

  isProcessing = true;

  try {
    const { goodId, usingRedis } = await pullNextId();
    if (!goodId) return;

    const ctx = {
      altegio_sku: '',
      quantity: null,
      storage_id: CONFIG.altegio.storageId,
    };

    try {
      await handleGoodId(goodId, ctx);
      retryCounts.delete(goodId);
      await finalizeSuccess(goodId, usingRedis);
    } catch (err) {
      const nextAttempt = (retryCounts.get(goodId) ?? 0) + 1;
      retryCounts.set(goodId, nextAttempt);

      CacheManager.logWebhook({ status: 'error', reason: err.message, type: 'correction', altegio_sku: ctx.altegio_sku, quantity: ctx.quantity });
      console.error('❌ Task failed:', err.message);

      const delay = Math.min(30000, CONFIG.queue.backoffBaseMs * Math.pow(2, nextAttempt));
      scheduleRetry(goodId, delay, usingRedis);
    }
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
