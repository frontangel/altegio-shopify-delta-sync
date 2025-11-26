import crypto from "crypto";
import { redis } from "../services/redis.js";

const STREAM_KEY = "webhook_logs";
const SKU_MAPPER_KEY = "sku_mapper";
const ARTICLE_MAPPER_KEY = "article_mapper";
const SKU_HASH = 'sku_mapper';
const ARTICLE_HASH = 'article_mapper';
const NOTFOUND_PREFIX = 'notfound:';
const NOT_FOUND_TTL = 10 * 60; // 10 хв у секундах

export const CacheManager = {
  // ---------- ЛОГИ ЧЕРЕЗ REDIS STREAMS ----------
  async logWebhook(entry) {
    const id = crypto.randomUUID();

    await redis.xadd(
      STREAM_KEY,
      "MAXLEN",
      "~",
      5000,         // авто-ротація
      "*",
      "id", id,
      "timestamp", Date.now(),
      "status", entry.status || "",
      "reason", entry.reason || "",
      "type", entry.type || "",
      "altegio_sku", entry.altegio_sku || "",
      "quantity", entry.quantity ?? ""
    );

    return id;
  },

  async getArticle(goodId) {
    return redis.hget(ARTICLE_HASH, goodId);
  },

  async hasArticle(goodId) {
    return redis.hexists(ARTICLE_HASH, goodId);
  },

  async setArticle(goodId, article) {
    return redis.hset(ARTICLE_HASH, goodId, article);
  },


  async getWebhookLogs(limit = 5000) {
    const raw = await redis.xrevrange(STREAM_KEY, "+", "-", "COUNT", limit);
    return raw.map(([id, arr]) => {
      const obj = {};
      for (let i = 0; i < arr.length; i += 2) {
        obj[arr[i]] = arr[i + 1];
      }
      obj._id = id;
      return obj;
    });
  },

  // ---------- SKU MAP ----------
  async setSkuMapping(altegioSku, inventoryId) {
    await redis.hset(SKU_MAPPER_KEY, altegioSku, inventoryId);
  },

  async getSkuMapping(altegioSku) {
    return redis.hget(SKU_MAPPER_KEY, altegioSku);
  },

  async allSkuMappings() {
    return redis.hgetall(SKU_HASH);
  },

  async getAllSkuMappings() {
    return redis.hgetall(SKU_MAPPER_KEY);
  },

  // ---------- ARTICLE MAP ----------
  async setArticleMapping(article, sku) {
    await redis.hset(ARTICLE_MAPPER_KEY, article, sku);
  },

  async getArticleMapping(article) {
    return redis.hget(ARTICLE_MAPPER_KEY, article);
  },

  async getAllArticleMappings() {
    return redis.hgetall(ARTICLE_MAPPER_KEY);
  },

  // ---------- NOT FOUND CACHE з TTL ----------
  async isNotFoundCached(sku) {
    return Boolean(await redis.exists(`notfound:${sku}`));
  },

  async setNotFound(sku) {
    // зберігаємо будь-яке значення
    await redis.set(`notfound:${sku}`, 1, "EX", NOT_FOUND_TTL);
  },

  // ---------- INVENTORY ITEM LOOKUP ----------
  async inventoryItemIdByAltegioSku(altegioSku, fetchShopifyFn) {
    // 1. Є у мапер?
    const cached = await this.getSkuMapping(altegioSku);
    if (cached) return cached;

    // 2. Якщо раніше не знаходили, чекаємо TTL
    if (await this.isNotFoundCached(altegioSku)) {
      return null;
    }

    // 3. Оновлюємо від Shopify
    await fetchShopifyFn();

    const updated = await this.getSkuMapping(altegioSku);
    if (updated) return updated;

    // 4. Кешуємо промах
    await this.setNotFound(altegioSku);
    return null;
  }
};
