import { useStore } from './useStore.js';

const { getShopifyInventoryIdsBySku } = useStore()
const skuMapper = new Map()
const articleMapper = new Map()
const notFoundCache = new Set()

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
    this.webhookLogs.push({ _id: Date.now() + Math.random(), timestamp: Date.now(), ...entry });
    if (this.webhookLogs.length > MAX_LOGS) {
      this.webhookLogs.splice(0, this.webhookLogs.length - MAX_LOGS);
    }
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
