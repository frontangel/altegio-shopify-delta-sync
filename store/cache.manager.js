import { useStore } from './useStore.js';

const { getShopifyInventoryIdsBySku } = useStore()
const skuMapper = new Map()
const articleMapper = new Map()
const notFoundCache = new Set()

export const CacheManager = {
  skuMapper,
  articleMapper,
  notFoundCache,
  webhookLogs: [],
  logWebhook(entry) {
    const now = Date.now();
    this.webhookLogs.unshift({ ...entry, timestamp: now });
    const oneDay = 24 * 60 * 60 * 1000;
    this.webhookLogs = this.webhookLogs.filter(log => now - log.timestamp < oneDay);
  },
  getWebhookLogs() {
    return this.webhookLogs;
  },
  shopifySkuInventory: () => Object.fromEntries(skuMapper),
  altegioArticleShopifySky: () => Object.fromEntries(articleMapper),
  inventoryItemIdByAltegioSku: async (altegioSku) => {
    if (!skuMapper.has(altegioSku)) {
      await getShopifyInventoryIdsBySku()
    }
    if (skuMapper.has(altegioSku)) return CacheManager.skuMapper.get(altegioSku)
    if (notFoundCache.has(altegioSku)) return null
    CacheManager.notFoundCache.add(altegioSku)
    return null
  }
}
