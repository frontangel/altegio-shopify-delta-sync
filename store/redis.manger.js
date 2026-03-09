import crypto from "crypto";
import redis, { isRedisReady } from "../services/redis.js";

const STREAM_KEY = "webhook_logs";
const QUEUE_KEY = "queue";
const QUEUE_CORRECTION = "queue:correction";
const QUEUE_PROCESSING = "queue:processing";
const QUEUE_DEAD_LETTER = "queue:dead_letter";
const SKU_DOUBLE_KEY = "double_mapper";
const LOGS_KEY = "webhook_logs";
const SKU_MAPPER_KEY = "sku_mapper";
const ARTICLE_MAPPER_KEY = "article_mapper";
const NOTFOUND_PREFIX = 'notfound:';
const NOT_FOUND_TTL = 10 * 60; // 10 хв у секундах
const IDEMPOTENCY_PREFIX = 'idempotency:';
const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 години
const LOCK_PREFIX = 'lock:sku:';
const LOCK_TTL = 30; // 30 секунд

export const RedisManager = {
  // -> WEBHOOK LOGS
  async setWebhookLogs(data) {
    const uuid = crypto.randomUUID();
    const timestamp = Date.now()
    const payload = {
      timestamp,
      exp: timestamp + 3 * 24 * 60 * 60 * 1000,
      ...data
    };
    await redis.set(`${LOGS_KEY}:${uuid}`, JSON.stringify(payload))
    await redis.expire(`${LOGS_KEY}:${uuid}`, 3 * 24 * 60 * 60);
    return uuid;
  },

  async getWebhookLogs(limit = 100) {
    return this.getAllByPatters(LOGS_KEY)
  },

  async updateLogWebhook(id, patch) {
    const raw = await redis.get(`${LOGS_KEY}:${id}`)
    const log = JSON.parse(raw)
    const reason = patch.reason ? [log.reason || '', patch.reason || ''].join('; ') : log.reason
    await redis.set(`${LOGS_KEY}:${id}`, JSON.stringify({...log, ...patch, reason}))
  },


  // -> QUEUE with BRPOPLPUSH pattern
  async setQueue(hookId, id, timestamp = Date.now()) {
    const payload = JSON.stringify({ hookId, id, retry: 0, createdAt: timestamp });
    await redis.rpush(QUEUE_CORRECTION, payload);
  },

  async nextQueue(timeout = 5) {
    if (!isRedisReady()) {
      return null;
    }

    // Use BRPOPLPUSH for atomic move from correction queue to processing queue
    const raw = await redis.brpoplpush(QUEUE_CORRECTION, QUEUE_PROCESSING, timeout);
    return raw ? JSON.parse(raw) : null;
  },

  async completeTask(task) {
    // Remove task from processing queue after successful completion
    const taskJson = JSON.stringify(task);
    await redis.lrem(QUEUE_PROCESSING, 1, taskJson);
  },

  async retryQueue(task) {
    task.retry += 1;
    task.retriedAt = Date.now();
    const taskJson = JSON.stringify(task);

    // Remove from processing queue
    await redis.lrem(QUEUE_PROCESSING, 1, taskJson);

    // Add back to correction queue for retry
    await redis.rpush(QUEUE_CORRECTION, taskJson);
  },

  async moveToDeadLetter(task, error) {
    const deadLetterEntry = {
      ...task,
      failedAt: Date.now(),
      error: error.message || String(error),
      stack: error.stack
    };

    // Remove from processing queue
    const taskJson = JSON.stringify(task);
    await redis.lrem(QUEUE_PROCESSING, 1, taskJson);

    // Add to dead letter queue
    await redis.rpush(QUEUE_DEAD_LETTER, JSON.stringify(deadLetterEntry));
  },

  async getQueue() {
    const items = await redis.lrange(QUEUE_CORRECTION, 0, -1);
    return items.map(i => JSON.parse(i));
  },

  async getProcessingQueue() {
    const items = await redis.lrange(QUEUE_PROCESSING, 0, -1);
    return items.map(i => JSON.parse(i));
  },

  async getDeadLetterQueue() {
    const items = await redis.lrange(QUEUE_DEAD_LETTER, 0, -1);
    return items.map(i => JSON.parse(i));
  },

  async recoverStaleTasks(staleTimeMs = 60000) {
    // Recover tasks that have been in processing queue too long
    const items = await redis.lrange(QUEUE_PROCESSING, 0, -1);
    const now = Date.now();
    let recovered = 0;

    for (const item of items) {
      const task = JSON.parse(item);
      const taskAge = now - (task.retriedAt || task.createdAt || 0);

      if (taskAge > staleTimeMs) {
        // Move stale task back to correction queue
        await redis.lrem(QUEUE_PROCESSING, 1, item);
        task.retry = (task.retry || 0) + 1;
        task.retriedAt = now;
        task.recovered = true;
        await redis.rpush(QUEUE_CORRECTION, JSON.stringify(task));
        recovered++;
      }
    }

    return recovered;
  },

  // -> IDEMPOTENCY
  async checkIdempotency(key) {
    const idempotencyKey = `${IDEMPOTENCY_PREFIX}${key}`;
    const exists = await redis.exists(idempotencyKey);
    return exists === 1;
  },

  async setIdempotency(key, data = {}) {
    const idempotencyKey = `${IDEMPOTENCY_PREFIX}${key}`;
    await redis.set(idempotencyKey, JSON.stringify(data), 'EX', IDEMPOTENCY_TTL);
  },

  // -> DISTRIBUTED LOCK
  async acquireLock(sku, workerId, ttl = LOCK_TTL) {
    const lockKey = `${LOCK_PREFIX}${sku}`;
    const acquired = await redis.set(lockKey, workerId, 'NX', 'EX', ttl);
    return acquired === 'OK';
  },

  async releaseLock(sku, workerId) {
    const lockKey = `${LOCK_PREFIX}${sku}`;
    // Only release if we own the lock
    const currentOwner = await redis.get(lockKey);
    if (currentOwner === workerId) {
      await redis.del(lockKey);
      return true;
    }
    return false;
  },

  async extendLock(sku, workerId, ttl = LOCK_TTL) {
    const lockKey = `${LOCK_PREFIX}${sku}`;
    const currentOwner = await redis.get(lockKey);
    if (currentOwner === workerId) {
      await redis.expire(lockKey, ttl);
      return true;
    }
    return false;
  },


  async altegioArticleShopifySky() {
    return redis.hgetall(ARTICLE_MAPPER_KEY);
  },

  async shopifySkuInventory() {
    return redis.hgetall(SKU_MAPPER_KEY);
  },


  async allSkuMappings() {
    return redis.hgetall(SKU_MAPPER_KEY);
  },

  async getAllSkuMappingsSize() {
    const records = await this.allSkuMappings();
    return Object.keys(records).length;
  },

  async setMultipleDoubles(skus) {
    const doubles = Object.entries(skus).reduce((acc, [key, value]) => {
      if (value.length > 1) {
        acc[key] = value;
      }
      return acc;
    }, {})

    for (const key in doubles) {
      await RedisManager.setDoubles(key, JSON.stringify(doubles[key]))
    }
  },

  async setDoubles(sku, inventoryItemId) {
    await redis.hset(SKU_DOUBLE_KEY, sku, inventoryItemId);
  },

  async clearDoubles() {
    await redis.del(SKU_DOUBLE_KEY);
  },

  async getDoubles() {
    return redis.hgetall(SKU_DOUBLE_KEY);
  },

  async setSkuMapping(sku, inventoryItemId) {
    await redis.del(NOTFOUND_PREFIX + sku);
    return redis.hset(SKU_MAPPER_KEY, sku, inventoryItemId);
  },

  async getSkuMapping(sku) {
    console.log('getSkuMapping', sku);
    return redis.hget(SKU_MAPPER_KEY, sku);
  },

  async getArticle(goodId) {
    return redis.hget(ARTICLE_MAPPER_KEY, goodId);
  },

  async setArticle(goodId, article) {
    await redis.hset(ARTICLE_MAPPER_KEY, goodId, article);
  },

  async cacheNotFound(sku) {
    return redis.set(NOTFOUND_PREFIX + sku, 1, 'EX', NOT_FOUND_TTL);
  },

  async getAllByPatters(patternPrefix = NOTFOUND_PREFIX) {
    const pattern = `${patternPrefix}:*`;
    let cursor = "0";
    let keys = [];

    do {
      const [newCursor, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      keys.push(...batch);
      cursor = newCursor;
    } while (cursor !== "0");

    if (keys.length === 0) return [];

    const values = await redis.mget(keys);

    return keys.map((key, i) => ({
      id: key.replace("WEBHOOK_LOG:", ""),
      ...JSON.parse(values[i] || "{}")
    }));
  },

  async getAllNotFoundRecords() {
    const records = await this.getAllByPatters(NOTFOUND_PREFIX);
    return records.length
  },


};
