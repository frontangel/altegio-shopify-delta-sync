import crypto from 'crypto';
import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js'
import { RedisManager } from '../store/redis.manger.js';
import {isRedisReady} from "./redis.js";

const WORKER_ID = crypto.randomUUID(); // Unique worker identifier
const MAX_RETRIES = 3; // Maximum retry attempts
const STALE_TASK_CHECK_INTERVAL = 60000; // Check for stale tasks every minute
const ENABLE_VERIFICATION = process.env.ENABLE_SHOPIFY_VERIFICATION !== 'false'; // Default true

// Get configuration from environment
const ALTEGIO_COMPANY_ID = process.env.ALTEGIO_COMPANY_ID || '1275575';
const ALTEGIO_STORAGE_ID = parseInt(process.env.ALTEGIO_STORAGE_ID || '2557508', 10);

export async function addIdsToQueue(hookId, ids) {
  const idArray = Array.isArray(ids) ? ids : [ids]

  for (const id of idArray) {
    await RedisManager.setQueue(hookId, id)
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

    try {
      await processNextId(task);
      // Task completed successfully - remove from processing queue
      await RedisManager.completeTask(task);
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
      } else {
        console.warn(`⚠️ Task failed (attempt ${retryCount + 1}/${MAX_RETRIES}), retrying:`, {
          hookId: task.hookId,
          goodId: task.id,
          error: err.message
        });
        await RedisManager.retryQueue(task);
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
  const goodId = task.id;

  // Generate idempotency key
  const idempotencyKey = crypto.createHash('sha256')
    .update(`${hookId}-${goodId}`)
    .digest('hex');

  const ctx = {
    altegio_sku: '',
    quantity: null,
    inventoryItemId: null,
    workerId: WORKER_ID
  }

  try {
    // Check idempotency - skip if already processed
    const alreadyProcessed = await RedisManager.checkIdempotency(idempotencyKey);
    if (alreadyProcessed) {
      console.log(`⏭️ Skipping already processed task: ${idempotencyKey}`);
      await RedisManager.updateLogWebhook(hookId, {
        status: 'skipped',
        reason: 'Already processed (idempotent)'
      });
      return;
    }

    // --- 1) Запит у Altegio ---
    console.log(`[Worker ${WORKER_ID}] Processing task ${hookId} - goodId: ${goodId}`);

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

    // --- 2) Acquire distributed lock for this SKU ---
    const lockAcquired = await RedisManager.acquireLock(ctx.altegio_sku, WORKER_ID, 30);
    if (!lockAcquired) {
      console.log(`🔒 Lock not acquired for SKU ${ctx.altegio_sku}, another worker is processing it`);
      // Re-queue the task to try again later
      throw new Error('Lock not acquired, will retry');
    }

    try {
      // --- 3) inventory item id ---
      const inventoryItemId = await RedisManager.getSkuMapping(ctx.altegio_sku);
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

      // --- 4) Shopify update ---
      console.log(`[Worker ${WORKER_ID}] Updating Shopify: ${inventoryItemId} = ${ctx.quantity}`);
      await ShopifyService.setAbsoluteQuantity(inventoryItemId, ctx.quantity);

      // --- 5) Verify update (optional) ---
      let verificationResult = null;
      if (ENABLE_VERIFICATION) {
        await sleep(500); // Brief delay for Shopify to process
        verificationResult = await ShopifyService.verifyQuantity(inventoryItemId, ctx.quantity);

        if (!verificationResult.verified) {
          console.error(`❌ Verification failed for ${inventoryItemId}:`, verificationResult);
          await RedisManager.updateLogWebhook(hookId, {
            status: 'warning',
            reason: `Update succeeded but verification failed: expected ${ctx.quantity}, got ${verificationResult.actual}`,
            altegio_sku: ctx.altegio_sku,
            quantity: ctx.quantity,
            verified: false
          });
          // Don't throw error - update was sent successfully
        } else {
          console.log(`✅ Verification passed for ${inventoryItemId}`);
        }
      }

      // --- 6) Mark as successfully processed ---
      await RedisManager.setIdempotency(idempotencyKey, {
        hookId,
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

      console.log(`✅ [Worker ${WORKER_ID}] Task completed: ${hookId}`);

    } finally {
      // Always release the lock
      await RedisManager.releaseLock(ctx.altegio_sku, WORKER_ID);
    }

  } catch (err) {
    console.error(`❌ [Worker ${WORKER_ID}] Task failed:`, {
      hookId,
      goodId,
      sku: ctx.altegio_sku,
      error: err.message,
      stack: err.stack
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

// Start worker loop
workerLoop()
  .then(() => console.log('✅ Queue worker started successfully'))
  .catch(err => console.error('❌ Queue worker failed to start:', err));

// Start stale task recovery
staleTaskRecovery()
  .then(() => console.log('✅ Stale task recovery started'))
  .catch(err => console.error('❌ Stale task recovery failed to start:', err));
