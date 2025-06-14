import { CacheManager } from './cache.manager.js';
import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js'


let shopifySkuInventoryPromise = null
let altegioArticlePromiseMap = new Map()

export function store () {
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
      let cursor = null
      let hasNextPage = true

      while (hasNextPage) {
        const response = await ShopifyService.getProducts(cursor)
        // if (!response.data) return
        const pageInfo = response.data?.products.pageInfo

        hasNextPage = pageInfo.hasNextPage
        cursor = pageInfo.endCursor

        for (const { node: product } of response.data.products.edges) {
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
      }
      shopifySkuInventoryPromise = null
    })()
    return shopifySkuInventoryPromise
  }

  const getShopifyInventoryItemById = async (inventoryId) => {
    return ShopifyService.getInventoryItemById(inventoryId)
  }

  return {
    getAltegioArticleById,
    getShopifyInventoryIdsBySku,
    getShopifyInventoryItemById
  }
}
