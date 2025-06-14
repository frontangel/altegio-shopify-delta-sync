import { CacheManager } from './cache.manager.js';
import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js'

let shopifySkuInventoryPromise = null
let altegioArticlePromiseMap = new Map()
let initialized = false;

export function useStore () {
  const setAltegioArticleById = (companyId, goodId) => {
    if (CacheManager.articleMapper.has(goodId)) return Promise.resolve()
    if (altegioArticlePromiseMap.has(goodId)) return altegioArticlePromiseMap.get(goodId)

    const promise = AltegioService.fetchProduct(companyId, goodId).then(({ data }) => {
      CacheManager.articleMapper.set(goodId, data.article)
    })
    altegioArticlePromiseMap.set(goodId, promise)
    return promise
  }

  const getAltegioArticleById = async (companyId, goodId) => {
    if (!CacheManager.articleMapper.has(goodId)) {
      await setAltegioArticleById(companyId, goodId)
    }
    return CacheManager.articleMapper.get(goodId)
  }

  const getShopifyInventoryIdsBySku = async () => {
    if (shopifySkuInventoryPromise) return shopifySkuInventoryPromise
    shopifySkuInventoryPromise = (async () => {
      const products = await ShopifyService.fetchAllProducts()
      for (const { node: product } of products) {
        if (product.status !== 'ACTIVE') continue
        for (const { node: variant } of product.variants.edges) {
          const meta = variant.metafields.edges.find(m => m.node.key === 'sku_from_altegio')
          const sku = meta?.node.value
          const inventoryItemId = variant.inventoryItem.id
          if (sku && inventoryItemId) {
            CacheManager.skuMapper.set(sku, inventoryItemId)
            CacheManager.notFoundCache.delete(sku)
          }
        }
      }

      shopifySkuInventoryPromise = null
      initialized = true
    })()
    return shopifySkuInventoryPromise
  }

  const isReady = () => initialized;

  return {
    getAltegioArticleById,
    getShopifyInventoryIdsBySku,
    isReady
  }
}
