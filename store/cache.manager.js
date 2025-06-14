const skuMapper = new Map()
const articleMapper = new Map()
const notFoundCache = new Set()

export const CacheManager = {
  skuMapper,
  articleMapper,
  notFoundCache,
  shopifySkuInventory: () => Object.fromEntries(skuMapper),
  altegioArticleShopifySky: () => Object.fromEntries(articleMapper),
  inventoryItemIdByAltegioSku: (altegioSku) => {
    if (skuMapper.has(altegioSku)) return CacheManager.skuMapper.get(altegioSku)
    if (notFoundCache.has(altegioSku)) return null
    CacheManager.notFoundCache.add(altegioSku)
    return null
  }
}
