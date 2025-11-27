
import * as AltegioService from '../services/altegio.service.js';
import * as ShopifyService from '../services/shopify.service.js';
import { RedisManager } from './redis.manger.js';

let shopifySkuInventoryPromise = null;
let altegioArticlePromiseMap = new Map();
let initialized = false;



export function useStore() {
  const skus = {}

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
              if (cleanSku in skus) {
                skus[cleanSku].push(inventoryItemId);
              } else {
                skus[cleanSku] = [inventoryItemId];
              }
              await RedisManager.setSkuMapping(cleanSku, inventoryItemId)
            }
          }
        }
        initialized = true;
      }
      catch (e) {
        console.error(e)
      }
      finally {
        shopifySkuInventoryPromise = null;
        await RedisManager.setMultipleDoubles(skus)
        const [skuMapperSize, notFoundCacheSize, notFound] = await Promise.all([RedisManager.getAllSkuMappingsSize(), RedisManager.getAllNotFoundRecords()]);
        console.log(
          `[Cache] skuMapper size=${skuMapperSize} notFoundCache size=${notFoundCacheSize}`
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
