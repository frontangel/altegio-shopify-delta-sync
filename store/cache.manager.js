import crypto from 'crypto';

import { useStore } from './useStore.js';

const { getShopifyInventoryIdsBySku } = useStore()
const skuMapper = new Map()
const articleMapper = new Map()
const notFoundCache = new Map()

// Тривалість кешу для «не знайдених» SKU (мс)
const NOT_FOUND_TTL_MS = 10 * 60 * 1000;

function isNotFoundCacheFresh(sku) {
  if (!notFoundCache.has(sku)) return false;
  const lastMiss = notFoundCache.get(sku);
  return Date.now() - lastMiss < NOT_FOUND_TTL_MS;
}

const MAX_LOGS = 5000;

export const CacheManager = {
  skuMapper,
  articleMapper,
  notFoundCache,
  webhookLogs: [],
  updateLogById(entry) {
    const log = this.webhookLogs.find(l => l._id === entry._id);
    if (!log) return false
    Object.assign(log, entry)
    return true
  },
  logWebhook(entry) {
    const hookId = crypto.randomUUID();

    this.webhookLogs.push({ _id: hookId, timestamp: Date.now(), ...entry });
    if (this.webhookLogs.length > MAX_LOGS) {
      this.webhookLogs.splice(0, this.webhookLogs.length - MAX_LOGS);
    }
    return hookId
  },
  getWebhookLogs() {
    return this.webhookLogs;
  },
  shopifySkuInventory: () => Object.fromEntries(skuMapper),
  altegioArticleShopifySky: () => Object.fromEntries(articleMapper),
  inventoryItemIdByAltegioSku: async (altegioSku) => {
    if (skuMapper.has(altegioSku)) return CacheManager.skuMapper.get(altegioSku)

    // Якщо SKU раніше не знаходили і кеш ще свіжий — не спамимо Shopify зайвими запитами
    if (isNotFoundCacheFresh(altegioSku)) return null

    await getShopifyInventoryIdsBySku()

    if (skuMapper.has(altegioSku)) return CacheManager.skuMapper.get(altegioSku)

    // Кешуємо промах лише з позначкою часу, щоб через деякий час перевірити знову
    CacheManager.notFoundCache.set(altegioSku, Date.now())
    return null
  }
}
