
import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js';
import { RedisManager } from './redis.manger.js';

let shopifySkuInventoryPromise = null;
let altegioArticlePromiseMap = new Map();
let initialized = false;
let lastRefreshAttemptAt = 0;



export function useStore() {
  const setAltegioArticleById = async (companyId, goodId) => {
    const candidate = await RedisManager.getArticle(goodId)
    if (candidate) return Promise.resolve(candidate);

    if (altegioArticlePromiseMap.has(goodId)) return altegioArticlePromiseMap.get(goodId);

    const promise = AltegioService.fetchProduct(companyId, goodId).then(({data}) => RedisManager.setArticle(goodId, data.article));
    altegioArticlePromiseMap.set(goodId, promise);
    return promise;
  };

  const getAltegioArticleById = async (companyId, goodId) => {
    const candidate = await RedisManager.getArticle(goodId)
    if (!candidate) {
      await setAltegioArticleById(companyId, goodId);
    }
    return candidate;
  };

  const getShopifyInventoryIdsBySku = async () => {
    if (shopifySkuInventoryPromise) return shopifySkuInventoryPromise;

    shopifySkuInventoryPromise = (async () => {
      lastRefreshAttemptAt = Date.now();
      // sku -> [inventoryItemId, ...] (кілька — це дублікати метаполя)
      const skus = {};
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
              (skus[cleanSku] ??= []).push(inventoryItemId);
            }
          }
        }

        // Останній варіант виграє — та сама поведінка, що й раніше з hset у циклі.
        const mapping = Object.fromEntries(
          Object.entries(skus).map(([sku, ids]) => [sku, ids[ids.length - 1]])
        );
        const size = await RedisManager.replaceSkuMappings(mapping);
        await RedisManager.clearDoubles();
        await RedisManager.setMultipleDoubles(skus);
        initialized = true;
        console.log(`[Cache] SKU mapping refreshed: size=${size}`);
        return size;
      }
      catch (e) {
        console.error('[Cache] SKU mapping refresh failed:', e?.message || e);
        return null;
      }
      finally {
        shopifySkuInventoryPromise = null;
      }
    })();

    return shopifySkuInventoryPromise;
  };

  // Оновлює мапінг лише якщо він старший за maxAgeMs (і ми самі не пробували
  // нещодавно) — щоб серія промахів по невідомому SKU не викликала шторм
  // повних сканів каталогу Shopify. Повертає true, якщо оновлення відбулось.
  const refreshSkuMappingIfStale = async (maxAgeMs) => {
    const refreshedAt = await RedisManager.getSkuMappingRefreshedAt();
    const last = Math.max(refreshedAt || 0, lastRefreshAttemptAt || 0);
    if (Date.now() - last < maxAgeMs) return false;
    const size = await getShopifyInventoryIdsBySku();
    return size !== null;
  };

  const isReady = () => initialized;

  return {
    getAltegioArticleById,
    getShopifyInventoryIdsBySku,
    refreshSkuMappingIfStale,
    isReady
  };
}
