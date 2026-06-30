import crypto from "crypto";
import redis, { isRedisReady } from "../services/redis.js";

const QUEUE_CORRECTION = "queue:correction";
const QUEUE_PROCESSING = "queue:processing";
const QUEUE_DEAD_LETTER = "queue:dead_letter";
const SKU_DOUBLE_KEY = "double_mapper";
const LOGS_KEY = "webhook_logs";
const LOGS_INDEX_KEY = "webhook_logs:index";
const SKU_MAPPER_KEY = "sku_mapper";
const ARTICLE_MAPPER_KEY = "article_mapper";
const NOTFOUND_PREFIX = 'notfound:';
const NOT_FOUND_TTL = 10 * 60; // 10 хв у секундах
const IDEMPOTENCY_PREFIX = 'idempotency:';
const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 години
const LOCK_PREFIX = 'lock:sku:';
const LOCK_TTL = 30; // 30 секунд

const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const EXTEND_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

function parseQueueTask(raw) {
  const parsed = JSON.parse(raw);
  return { ...parsed, __raw: raw };
}

function stringifyQueueTask(task) {
  const { __raw, ...cleanTask } = task;
  return JSON.stringify(cleanTask);
}

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
    await redis.set(`${LOGS_KEY}:${uuid}`, JSON.stringify(payload));
    await redis.expire(`${LOGS_KEY}:${uuid}`, 3 * 24 * 60 * 60);
    await redis.zadd(LOGS_INDEX_KEY, timestamp, uuid);
    // best-effort cleanup of stale index members (older than 7 days)
    await redis.zremrangebyscore(LOGS_INDEX_KEY, 0, Date.now() - 7 * 24 * 60 * 60 * 1000);
    return uuid;
  },

  async getWebhookLogs(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const ids = await redis.zrevrange(LOGS_INDEX_KEY, 0, safeLimit - 1);
    if (ids.length === 0) return [];

    const keys = ids.map(id => `${LOGS_KEY}:${id}`);
    const values = await redis.mget(keys);

    const result = [];
    for (let i = 0; i < ids.length; i += 1) {
      const value = values[i];
      if (!value) {
        await redis.zrem(LOGS_INDEX_KEY, ids[i]);
        continue;
      }
      result.push({
        id: ids[i],
        ...JSON.parse(value)
      });
    }
    return result;
  },

  async updateLogWebhook(id, patch) {
    const raw = await redis.get(`${LOGS_KEY}:${id}`)
    if (!raw) return false;
    const log = JSON.parse(raw)
    const reason = patch.reason ? [log.reason || '', patch.reason || ''].join('; ') : log.reason
    await redis.set(`${LOGS_KEY}:${id}`, JSON.stringify({...log, ...patch, reason}));
    return true;
  },


  // -> QUEUE with BRPOPLPUSH pattern
  async setQueue(hookId, id, timestamp = Date.now()) {
    const payload = JSON.stringify({
      taskId: crypto.randomUUID(),
      taskType: 'webhook',
      hookId,
      id,
      retry: 0,
      createdAt: timestamp
    });
    await redis.rpush(QUEUE_CORRECTION, payload);
  },

  async setManualQueue(hookId, sku, quantity, inventoryItemId, timestamp = Date.now()) {
    const payload = JSON.stringify({
      taskId: crypto.randomUUID(),
      taskType: 'manual',
      hookId,
      sku,
      quantity,
      inventoryItemId,
      retry: 0,
      createdAt: timestamp
    });
    await redis.rpush(QUEUE_CORRECTION, payload);
  },

  async nextQueue(timeout = 5) {
    if (!isRedisReady()) {
      return null;
    }

    // Use BRPOPLPUSH for atomic move from correction queue to processing queue
    const raw = await redis.brpoplpush(QUEUE_CORRECTION, QUEUE_PROCESSING, timeout);
    return raw ? parseQueueTask(raw) : null;
  },

  async completeTask(task) {
    // Remove task from processing queue after successful completion
    const taskJson = task.__raw || stringifyQueueTask(task);
    await redis.lrem(QUEUE_PROCESSING, 1, taskJson);
  },

  async retryQueue(task) {
    const taskJson = task.__raw || stringifyQueueTask(task);
    const nextTask = {
      ...task,
      retry: (task.retry || 0) + 1,
      retriedAt: Date.now()
    };
    const nextTaskJson = stringifyQueueTask(nextTask);

    // Remove from processing queue
    await redis.lrem(QUEUE_PROCESSING, 1, taskJson);

    // Add back to correction queue for retry
    await redis.rpush(QUEUE_CORRECTION, nextTaskJson);
  },

  async moveToDeadLetter(task, error) {
    const deadLetterEntry = {
      ...JSON.parse(stringifyQueueTask(task)),
      failedAt: Date.now(),
      error: error.message || String(error),
      stack: error.stack
    };

    // Remove from processing queue
    const taskJson = task.__raw || stringifyQueueTask(task);
    await redis.lrem(QUEUE_PROCESSING, 1, taskJson);

    // Add to dead letter queue
    await redis.rpush(QUEUE_DEAD_LETTER, JSON.stringify(deadLetterEntry));
  },

  async getQueue() {
    const items = await redis.lrange(QUEUE_CORRECTION, 0, -1);
    return items.map(i => parseQueueTask(i));
  },

  async getProcessingQueue() {
    const items = await redis.lrange(QUEUE_PROCESSING, 0, -1);
    return items.map(i => parseQueueTask(i));
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
    const released = await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, workerId);
    return Number(released) === 1;
  },

  async extendLock(sku, workerId, ttl = LOCK_TTL) {
    const lockKey = `${LOCK_PREFIX}${sku}`;
    const extended = await redis.eval(EXTEND_LOCK_LUA, 1, lockKey, workerId, ttl);
    return Number(extended) === 1;
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
