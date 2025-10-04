import { CacheManager } from './cache.manager.js';
import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js';

let shopifySkuInventoryPromise = null;
let altegioArticlePromiseMap = new Map();
let initialized = false;

export function useStore() {
  const setAltegioArticleById = (companyId, goodId) => {
    if (CacheManager.articleMapper.has(goodId)) return Promise.resolve();
    if (altegioArticlePromiseMap.has(goodId)) return altegioArticlePromiseMap.get(goodId);

    const promise = AltegioService.fetchProduct(companyId, goodId).then(({data}) => {
      CacheManager.articleMapper.set(goodId, data.article);
    });
    altegioArticlePromiseMap.set(goodId, promise);
    return promise;
  };

  const getAltegioArticleById = async (companyId, goodId) => {
    if (!CacheManager.articleMapper.has(goodId)) {
      await setAltegioArticleById(companyId, goodId);
    }
    return CacheManager.articleMapper.get(goodId);
  };

  const getShopifyInventoryIdsBySku = async () => {
    if (shopifySkuInventoryPromise) return shopifySkuInventoryPromise;

    shopifySkuInventoryPromise = (async () => {
      try {
        const products = await ShopifyService.fetchAllProducts();
        for (const { node: product } of (products ?? [])) {
          if (!product || product.status !== 'ACTIVE') continue;

          const variantEdges = product.variants?.edges ?? [];
          for (const { node: variant } of variantEdges) {
            if (!variant) continue;

            // основний шлях: точкове поле metafield(...)
            let sku = variant.metafield?.value ?? null;

            // fallback: якщо раптом приходить старий список metafields(...)
            if (!sku && variant.metafields?.edges) {
              const meta = variant.metafields.edges.find(
                m => m?.node?.key === 'sku_from_altegio' || m?.node?.key === 'skuFromAltegio'
              );
              sku = meta?.node?.value ?? null;
            }

            const inventoryItemId = variant.inventoryItem?.id ?? null;
            const cleanSku = typeof sku === 'string' ? sku.trim() : null;

            if (cleanSku && inventoryItemId) {
              CacheManager.skuMapper.set(cleanSku, inventoryItemId);
              CacheManager.notFoundCache.delete(cleanSku);
            }
          }
        }
        initialized = true;
      } finally {
        // важливо: не лишати «завислу» promise при помилці
        shopifySkuInventoryPromise = null;

        console.log(
          `[Cache] skuMapper size=${CacheManager.skuMapper.size} notFoundCache size=${CacheManager.notFoundCache.size}`
        );
      }
    })();


    return shopifySkuInventoryPromise;
  };

  const isReady = () => initialized;

  return {
    getAltegioArticleById,
    getShopifyInventoryIdsBySku,
    isReady
  };
}
