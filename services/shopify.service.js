import { GraphQLClient } from 'graphql-request';
import { useUtils } from '../utils/index.js';

const {sleep} = useUtils();

const version = process.env.SF_API_VERSION;
const domain = process.env.SF_DOMAIN;
const url = `https://${domain}/admin/api/${version}/graphql.json`;
const accessToken = process.env.SF_ADMIN_ACCESS_TOKEN;
const locationId = process.env.SF_CONST_LOCATION_ID;

const shopify = new GraphQLClient(url, {
  headers: {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
  },
});

export async function getProducts(cursor = null, first = 150) {
  const variables = { cursor, first };
  const query = `
    query($cursor: String, $first: Int!) {
      products(first: $first, after: $cursor, sortKey: ID, query: "status:active") {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            status
            variants(first: 50) {
              edges {
                node {
                  id
                  sku
                  inventoryItem { id }
                  metafield(namespace: "custom", key: "sku_from_altegio") { value }
                }
              }
            }
          }
        }
      }
    }
  `;
  return requestWithThrottle(query, variables);
}

export async function fetchAllProducts() {
  const all = [];
  let cursor = null;
  let first = 150;     // стартовий розмір сторінки
  let cleanStreak = 0; // сторінки без throttling поспіль
  let page = 0;

  while (true) {
    page += 1;
    const startedAt = Date.now();
    const res = await getProducts(cursor, first);
    const { edges = [], pageInfo } = res.products ?? {};

    const tookMs = Date.now() - startedAt;
    const { attempts, waitedMs } = getLastThrottle();

    console.log(
      `[Shopify] page=${page} first=${first} items=${edges.length} ` +
      `throttle(attempts=${attempts}, waitedMs=${waitedMs}) took=${tookMs}ms`
    );

    all.push(...edges);

    // адаптація розміру сторінки
    if (attempts > 0 || waitedMs > 1500) {
      cleanStreak = 0;
      const old = first;
      first = Math.max(50, first - 25);
      if (first !== old) {
        console.warn(`[Shopify] reducing page size: ${old} → ${first}`);
      }
    } else {
      cleanStreak += 1;
      if (cleanStreak >= 3) {
        const old = first;
        first = Math.min(200, first + 25);
        cleanStreak = 0;
        if (first !== old) {
          console.log(`[Shopify] increasing page size: ${old} → ${first}`);
        }
      }
    }

    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  console.log(`[Shopify] fetched products total edges=${all.length}`);
  return all; // масив product edges
}

export async function getInventoryItemById(inventoryItemId) {
  const query = `
    query GetInventoryItem($id: ID!) {
      inventoryItem(id: $id) {
        id
        inventoryLevels(first: 10) {
          edges {
            node {
              id
              location {
                id
                name
              }
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }
  `;

  try {
    const resp = await requestWithThrottle(query, { id: inventoryItemId });

    // Для дебагу — один раз глянути що реально приходить
    // console.dir(resp, { depth: null });

    // Пробуємо кілька варіантів структури
    const item =
      resp?.data?.inventoryItem ??
      resp?.inventoryItem ??
      resp?.data?.data?.inventoryItem ??
      null;

    if (!item) {
      console.error('❌ inventoryItem not found in response for id:', inventoryItemId);
      console.dir(resp, { depth: null });
      throw new Error(`Inventory item not found for ID: ${inventoryItemId}`);
    }

    const levels =
      item.inventoryLevels?.edges?.map(e => e?.node).filter(Boolean) ?? [];

    return {
      id: item.id,
      inventoryLevels: levels
    };

  } catch (err) {
    const gqlErrors =
      err?.response?.data?.errors ??
      err?.response?.errors ??
      err.message;

    console.error('❌ Failed to fetch inventory item:', gqlErrors);
    throw err;
  }
}


export async function setAbsoluteQuantity(inventoryItemId, quantity) {
  const mutation = `
    mutation InventorySet($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
          createdAt
          reason
          changes {
            name
            delta
          }
        }
        userErrors {
          field
          message
        }
      }
    }`;

  const variables = {
    input: {
      reason: 'correction',
      name: 'available',
      ignoreCompareQuantity: true,
      quantities: [
        {
          inventoryItemId,
          locationId,
          quantity
        },
      ],
    },
  };

  try {
    const result = await requestWithThrottle(mutation, variables);
    if (result.inventorySetQuantities.userErrors?.length > 0) {
      throw new Error('Shopify returned userErrors');
    }
  } catch (e) {
    console.error('Failed to set quantity:', JSON.stringify(e.response?.errors[0]?.extensions, null, 2) || e.message);
    throw e;
  }
}

// export async function mutateInventoryQuantity(ctx) {
//   const {inventory_item_id: inventoryItemId, amount: delta} = ctx.state;
//
//   const query = `
//     mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
//       inventoryAdjustQuantities(input: $input) {
//         inventoryAdjustmentGroup {
//           changes {
//             name
//             delta
//           }
//         }
//         userErrors {
//           field
//           message
//         }
//       }
//     }
//   `;
//   const variables = {
//     input: {
//       reason: 'correction',
//       name: 'available',
//       changes: [
//         {
//           inventoryItemId,
//           locationId,
//           delta,
//         },
//       ],
//     },
//   };
//
//   try {
//     const response = await requestWithThrottle(query, variables);
//
//     if (response.inventoryAdjustQuantities.userErrors?.length) {
//       ctx.log.status = 'error';
//       ctx.log.reason = response.inventoryAdjustQuantities.userErrors;
//     } else {
//       ctx.log.status = 'success';
//       ctx.log.reason = `Inventory adjusted: ${delta}`;
//     }
//     // CacheManager.updateLogById(ctx.log);
//     // await RedisManager.updateLogWebhook()
//   } catch (error) {
//     ctx.log.status = 'error';
//     ctx.log.reason = error.response?.errors || error.message;
//     // CacheManager.updateLogById(ctx.log);
//     throw error;
//   }
// }

let _lastThrottle = { attempts: 0, waitedMs: 0 };
export function getLastThrottle() { return _lastThrottle; }

export async function requestWithThrottle(query, variables = {}, { maxRetries = 8 } = {}) {
  let attempt = 0;
  _lastThrottle = { attempts: 0, waitedMs: 0 };

  while (true) {
    try {
      const res = await shopify.request(query, variables);
      return res; // УВАГА: graphql-request повертає одразу data-тіло
    } catch (err) {
      const code =
        err?.response?.errors?.[0]?.extensions?.code ||
        err?.response?.extensions?.code;
      const cost = err?.response?.extensions?.cost;
      const throttle = cost?.throttleStatus;

      if (code !== 'THROTTLED' && !throttle) throw err;

      attempt += 1;
      if (attempt > maxRetries) {
        throw new Error(`Shopify THROTTLED: перевищено кількість спроб (${maxRetries}). ${err.message}`);
      }

      const requested = cost?.requestedQueryCost ?? 1000;
      const available = throttle?.currentlyAvailable ?? 0;
      const restoreRate = throttle?.restoreRate ?? 50; // кредити/сек
      const deficit = Math.max(0, requested - available);
      const waitSec = Math.max(1.5, Math.ceil(deficit / restoreRate));
      const jitterMs = Math.floor(Math.random() * 300);
      const waitMs = waitSec * 1000 + jitterMs;

      console.warn(`[Shopify] THROTTLED. requested=${requested}, available=${available}, rate=${restoreRate}/s, attempt=${attempt}. wait≈${waitMs}ms`);
      _lastThrottle.attempts += 1;
      _lastThrottle.waitedMs += waitMs;

      await sleep(waitMs);
    }
  }
}
