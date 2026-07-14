import crypto from 'crypto';
import { debuglog } from 'util';
import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js'
import { RedisManager } from '../store/redis.manger.js';
import {isRedisReady} from "./redis.js";

// Verbose per-step sync logging is opt-in via NODE_DEBUG=queue2 (Node's built-in
// debug module). This keeps routine step logs out of production output entirely,
// so we stay well under Railway's logging rate limit while still allowing the
// verbose trail to be enabled locally/for debugging when needed.
const debug = debuglog('queue2');

const WORKER_ID = crypto.randomUUID(); // Unique worker identifier
const MAX_RETRIES = 3; // Maximum retry attempts
const STALE_TASK_CHECK_INTERVAL = 60000; // Check for stale tasks every minute
const ENABLE_VERIFICATION = process.env.ENABLE_SHOPIFY_VERIFICATION !== 'false'; // Default true

// Get configuration from environment
const ALTEGIO_COMPANY_ID = process.env.ALTEGIO_COMPANY_ID || '1275575';
const ALTEGIO_STORAGE_ID = parseInt(process.env.ALTEGIO_STORAGE_ID || '2557508', 10);
const SHOPIFY_LOCATION_ID = process.env.SF_CONST_LOCATION_ID;
const LOCK_TTL_SECONDS = 30;
const LOCK_HEARTBEAT_INTERVAL_MS = 10000;

function taskTag(task) {
  const identity = task.taskType === 'manual'
    ? `sku=${task.sku}`
    : `goodId=${task.id}`;
  return `[Sync hookId=${task.hookId} ${identity} worker=${WORKER_ID}]`;
}

// Routine sync steps are extremely high-volume (thousands of tasks/day, 10+
// steps each) and were exceeding Railway's logging rate limit when emitted via
// console.log(). They're now emitted at debug level only - enable them locally
// or for troubleshooting by running with NODE_DEBUG=queue2. Critical lifecycle
// events (task picked/completed/dead-lettered, stale task recovery) still use
// console.log() directly so they remain visible in production.
function logStep(task, step, details = {}) {
  if (!debug.enabled) return;
  const payload = {
    step,
    ...details
  };
  debug(`${taskTag(task)} ${JSON.stringify(payload)}`);
}

function logError(task, step, error, details = {}) {
  const payload = {
    step,
    error: error?.message || String(error),
    ...details
  };
  console.error(`${taskTag(task)} ${JSON.stringify(payload)}`);
}

function getLocationAvailableQuantity(item, locationId) {
  const levels = item?.inventoryLevels || [];
  const level = levels.find(l => l?.location?.id === locationId);
  const available = level?.quantities?.find(q => q?.name === 'available');
  return available?.quantity ?? null;
}

export async function addIdsToQueue(hookId, ids) {
  const idArray = Array.isArray(ids) ? ids : [ids]

  for (const id of idArray) {
    await RedisManager.setQueue(hookId, id)
    console.log(`[Queue] queued task hookId=${hookId} goodId=${id}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function workerLoop() {
  console.log(`🚀 Worker ${WORKER_ID} started`);

  while (true) {
    if (!isRedisReady()) {
      console.log("⏳ Waiting for Redis...");
      await sleep(2000);
      continue;
    }

    const task = await RedisManager.nextQueue();
    if (!task) {
      // No tasks available, wait before checking again
      await sleep(3000);
      continue;
    }

    // Critical lifecycle event - kept at console.log() level so it stays
    // visible in production without contributing to per-step log volume.
    console.log(`${taskTag(task)} queue.task.picked retry=${task.retry || 0}`);

    try {
      await processNextId(task);
      // Task completed successfully - remove from processing queue
      await RedisManager.completeTask(task);
      // Critical lifecycle event - console.log() by design (see above).
      console.log(`${taskTag(task)} queue.task.completed`);
    } catch (err) {
      const retryCount = task.retry || 0;

      if (retryCount >= MAX_RETRIES) {
        console.error(`❌ Task failed after ${MAX_RETRIES} attempts, moving to dead letter queue:`, {
          hookId: task.hookId,
          goodId: task.id,
          error: err.message
        });
        await RedisManager.moveToDeadLetter(task, err);
        await RedisManager.updateLogWebhook(task.hookId, {
          status: 'failed',
          reason: `Failed after ${MAX_RETRIES} retries: ${err.message}`
        });
        logError(task, 'queue.task.dead_letter', err, {
          attempts: retryCount,
          maxRetries: MAX_RETRIES
        });
      } else {
        console.warn(`⚠️ Task failed (attempt ${retryCount + 1}/${MAX_RETRIES}), retrying:`, {
          hookId: task.hookId,
          goodId: task.id,
          error: err.message
        });
        await RedisManager.retryQueue(task);
        logError(task, 'queue.task.retry_scheduled', err, {
          nextRetry: retryCount + 1,
          maxRetries: MAX_RETRIES
        });
      }
    }
  }
}

async function staleTaskRecovery() {
  while (true) {
    try {
      await sleep(STALE_TASK_CHECK_INTERVAL);
      if (!isRedisReady()) continue;

      const recovered = await RedisManager.recoverStaleTasks(60000); // 60 second threshold
      if (recovered > 0) {
        console.log(`♻️ Recovered ${recovered} stale tasks from processing queue`);
      }
    } catch (err) {
      console.error('Error in stale task recovery:', err.message);
    }
  }
}

export async function processNextId(task) {
  const hookId = task.hookId;
  const goodId = task.id || null;
  const taskType = task.taskType || 'webhook';
  const taskIdentity = taskType === 'manual'
    ? `${task.sku}:${task.quantity}:${task.inventoryItemId}`
    : String(goodId);

  // Generate idempotency key
  const idempotencyKey = crypto.createHash('sha256')
    .update(`${hookId}-${taskType}-${taskIdentity}`)
    .digest('hex');

  const ctx = {
    altegio_sku: '',
    quantity: null,
    inventoryItemId: null,
    shopifyQuantityBefore: null,
    shopifyQuantityAfter: null,
    workerId: WORKER_ID
  }

  try {
    logStep(task, 'sync.start', {
      source: 'Altegio',
      target: 'Shopify',
      companyId: ALTEGIO_COMPANY_ID,
      storageId: ALTEGIO_STORAGE_ID,
      taskType
    });

    // Check idempotency - skip if already processed
    const alreadyProcessed = await RedisManager.checkIdempotency(idempotencyKey);
    if (alreadyProcessed) {
      logStep(task, 'sync.skipped.idempotent', {
        idempotencyKey
      });
      await RedisManager.updateLogWebhook(hookId, {
        status: 'skipped',
        reason: 'Already processed (idempotent)'
      });
      return;
    }

    if (taskType === 'manual') {
      ctx.altegio_sku = task.sku;
      ctx.quantity = Number(task.quantity);
      ctx.inventoryItemId = task.inventoryItemId || null;

      if (!ctx.altegio_sku || Number.isNaN(ctx.quantity)) {
        throw new Error('Invalid manual sync task payload');
      }

      logStep(task, 'manual.task.parsed', {
        altegioSku: ctx.altegio_sku,
        quantity: ctx.quantity,
        inventoryItemId: ctx.inventoryItemId
      });
    } else {
      // --- 1) Запит у Altegio ---
      logStep(task, 'altegio.fetch.start');

      const productRes = await AltegioService.fetchProduct(ALTEGIO_COMPANY_ID, goodId);
      const data = productRes?.data;
      if (!data) {
        await RedisManager.updateLogWebhook(hookId, {
          status: 'error',
          reason: 'Invalid Altegio product response',
          altegio_sku: ctx.altegio_sku,
          quantity: ctx.quantity
        });
        throw new Error('Invalid Altegio product response');
      }

      ctx.altegio_sku = data.article;

      if (!ctx.altegio_sku) {
        await RedisManager.updateLogWebhook(hookId, {
          status: 'skipped',
          reason: 'Product has no article/SKU',
          altegio_sku: ctx.altegio_sku,
          quantity: ctx.quantity
        });
        return;
      }

      const amounts = data.actual_amounts || [];
      ctx.quantity = amounts.find(a => a.storage_id === ALTEGIO_STORAGE_ID)?.amount ?? 0;
      logStep(task, 'altegio.fetch.success', {
        altegioGoodId: goodId,
        altegioSku: ctx.altegio_sku,
        altegioQuantity: ctx.quantity,
        storageId: ALTEGIO_STORAGE_ID
      });
    }

    // --- 2) Acquire distributed lock for this SKU ---
    logStep(task, 'lock.acquire.start', {
      sku: ctx.altegio_sku
    });
    const lockAcquired = await RedisManager.acquireLock(ctx.altegio_sku, WORKER_ID, LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      logStep(task, 'lock.acquire.failed', {
        sku: ctx.altegio_sku,
        reason: 'already_locked'
      });
      // Re-queue the task to try again later
      throw new Error('Lock not acquired, will retry');
    }
    logStep(task, 'lock.acquire.success', {
      sku: ctx.altegio_sku
    });

    const lockHeartbeat = setInterval(async () => {
      try {
        const extended = await RedisManager.extendLock(ctx.altegio_sku, WORKER_ID, LOCK_TTL_SECONDS);
        if (!extended) {
          logStep(task, 'lock.heartbeat.missed', { sku: ctx.altegio_sku });
        }
      } catch (heartbeatErr) {
        logError(task, 'lock.heartbeat.error', heartbeatErr, { sku: ctx.altegio_sku });
      }
    }, LOCK_HEARTBEAT_INTERVAL_MS);

    try {
      // --- 3) inventory item id ---
      const inventoryItemId = ctx.inventoryItemId || await RedisManager.getSkuMapping(ctx.altegio_sku);
      if (!inventoryItemId) {
        await RedisManager.updateLogWebhook(hookId, {
          status: 'skipped',
          reason: 'Inventory item id not found',
          altegio_sku: ctx.altegio_sku,
          quantity: ctx.quantity
        });
        return;
      }

      ctx.inventoryItemId = inventoryItemId;
      logStep(task, 'mapping.found', {
        altegioSku: ctx.altegio_sku,
        shopifyInventoryItemId: inventoryItemId
      });

      try {
        const currentInventory = await ShopifyService.getInventoryItemById(inventoryItemId);
        ctx.shopifyQuantityBefore = getLocationAvailableQuantity(currentInventory, SHOPIFY_LOCATION_ID);
      } catch (readErr) {
        logError(task, 'shopify.quantity_before.read_failed', readErr, {
          shopifyInventoryItemId: inventoryItemId
        });
      }

      // --- 4) Shopify update ---
      logStep(task, 'shopify.update.start', {
        sourceSystem: 'Altegio',
        targetSystem: 'Shopify',
        altegioSku: ctx.altegio_sku,
        shopifyInventoryItemId: inventoryItemId,
        quantityFrom: ctx.shopifyQuantityBefore,
        quantityTo: ctx.quantity
      });
      await ShopifyService.setAbsoluteQuantity(inventoryItemId, ctx.quantity);
      logStep(task, 'shopify.update.success', {
        shopifyInventoryItemId: inventoryItemId,
        quantityTo: ctx.quantity
      });

      // --- 5) Verify update (optional) ---
      let verificationResult = null;
      if (ENABLE_VERIFICATION) {
        await sleep(500); // Brief delay for Shopify to process
        verificationResult = await ShopifyService.verifyQuantity(inventoryItemId, ctx.quantity);
        ctx.shopifyQuantityAfter = verificationResult?.actual ?? null;

        if (!verificationResult.verified) {
          logStep(task, 'shopify.verify.failed', {
            altegioSku: ctx.altegio_sku,
            shopifyInventoryItemId: inventoryItemId,
            expectedQuantity: ctx.quantity,
            actualQuantity: verificationResult.actual ?? null
          });
          await RedisManager.updateLogWebhook(hookId, {
            status: 'warning',
            reason: `Update succeeded but verification failed: expected ${ctx.quantity}, got ${verificationResult.actual}`,
            altegio_sku: ctx.altegio_sku,
            quantity: ctx.quantity,
            verified: false
          });
          // Don't throw error - update was sent successfully
        } else {
          logStep(task, 'shopify.verify.success', {
            altegioSku: ctx.altegio_sku,
            shopifyInventoryItemId: inventoryItemId,
            expectedQuantity: ctx.quantity,
            actualQuantity: verificationResult.actual ?? null
          });
        }
      }

      // --- 6) Mark as successfully processed ---
      await RedisManager.setIdempotency(idempotencyKey, {
        hookId,
        taskType,
        goodId,
        sku: ctx.altegio_sku,
        quantity: ctx.quantity,
        inventoryItemId,
        processedAt: Date.now(),
        workerId: WORKER_ID
      });

      await RedisManager.updateLogWebhook(hookId, {
        status: 'success',
        altegio_sku: ctx.altegio_sku,
        quantity: ctx.quantity,
        verified: verificationResult?.verified ?? null
      });

      logStep(task, 'sync.success', {
        sourceSystem: 'Altegio',
        targetSystem: 'Shopify',
        taskType,
        altegioGoodId: goodId,
        altegioSku: ctx.altegio_sku,
        shopifyInventoryItemId: inventoryItemId,
        altegioQuantity: ctx.quantity,
        shopifyQuantityBefore: ctx.shopifyQuantityBefore,
        shopifyQuantityAfter: ctx.shopifyQuantityAfter,
        verified: verificationResult?.verified ?? null
      });

    } finally {
      clearInterval(lockHeartbeat);
      // Always release the lock
      await RedisManager.releaseLock(ctx.altegio_sku, WORKER_ID);
      logStep(task, 'lock.released', {
        sku: ctx.altegio_sku
      });
    }

  } catch (err) {
    logError(task, 'sync.failed', err, {
      sourceSystem: 'Altegio',
      targetSystem: 'Shopify',
      taskType,
      altegioGoodId: goodId,
      altegioSku: ctx.altegio_sku,
      shopifyInventoryItemId: ctx.inventoryItemId,
      altegioQuantity: ctx.quantity,
      shopifyQuantityBefore: ctx.shopifyQuantityBefore
    });

    await RedisManager.updateLogWebhook(hookId, {
      status: 'error',
      reason: err.message,
      altegio_sku: ctx.altegio_sku,
      quantity: ctx.quantity
    });

    throw err;
  }
}

let started = false;
export function startQueueWorker() {
  if (started) return;
  started = true;

  workerLoop()
    .then(() => console.log('✅ Queue worker started successfully'))
    .catch(err => console.error('❌ Queue worker failed to start:', err));

  staleTaskRecovery()
    .then(() => console.log('✅ Stale task recovery started'))
    .catch(err => console.error('❌ Stale task recovery failed to start:', err));
}

if (process.env.QUEUE_WORKER_AUTOSTART !== 'false') {
  startQueueWorker();
}
