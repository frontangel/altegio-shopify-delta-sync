import crypto from "crypto";
import redis from "../services/redis.js";

const STREAM_KEY = "webhook_logs";
const QUEUE_KEY = "queue";
const SKU_DOUBLE_KEY = "double_mapper";
const LOGS_KEY = "webhook_logs";
const SKU_MAPPER_KEY = "sku_mapper";
const ARTICLE_MAPPER_KEY = "article_mapper";
const NOTFOUND_PREFIX = 'notfound:';
const NOT_FOUND_TTL = 10 * 60; // 10 хв у секундах

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


  // -> QUEUE
  async setQueue(hookId, id) {
    const payload = JSON.stringify({ hookId, id, retry: 0 });
    await redis.rpush("queue:correction", payload);
  },

  async nextQueue() {
    const raw = await redis.lpop("queue:correction");
    return raw ? JSON.parse(raw) : null;
  },

  async retryQueue(task) {
    task.retry += 1;
    await redis.rpush("queue:correction", JSON.stringify(task));
  },

  async getQueue() {
    const items = await redis.lrange("queue:correction", 0, -1);
    return items.map(i => JSON.parse(i));
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
