import { GraphQLClient } from 'graphql-request';
import { useUtils } from '../utils/index.js';
import { CacheManager } from '../store/cache.manager.js';
import { CONFIG } from '../utils/config.js';

const {sleep} = useUtils();

const version = CONFIG.shopify.apiVersion;
const domain = CONFIG.shopify.domain;
const url = `https://${domain}/admin/api/${version}/graphql.json`;
const accessToken = CONFIG.shopify.adminAccessToken;
const locationId = CONFIG.shopify.locationId;

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
  const res = await requestWithThrottle(query, variables);
  return res; // { products: { pageInfo, edges } }
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
    const data = await requestWithThrottle(query, {id: inventoryItemId});
    return data.inventoryItem;
  } catch (error) {
    console.error('Failed to fetch inventory item:', error.response?.errors || error.message);
    throw error;
  }
}

export async function setAbsoluteQuantity(inventoryItemId, quantity, context = {}) {
  const safeQuantity = Number.isFinite(quantity) ? Number(quantity) : null;
  if (safeQuantity === null || safeQuantity < 0) {
    const detail = safeQuantity === null ? 'Missing quantity' : 'Negative quantity';
    const error = new Error(`${detail} for inventory item ${inventoryItemId}`);
    console.error(error.message, { inventoryItemId, quantity });
    throw error;
  }

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
          quantity: safeQuantity
        },
      ],
    },
  };

  try {
    const result = await requestWithThrottle(mutation, variables);
    if (result.inventorySetQuantities.userErrors?.length > 0) {
      const details = JSON.stringify(result.inventorySetQuantities.userErrors);
      const err = new Error(`Shopify returned userErrors: ${details}`);
      console.error('Failed to set quantity:', { inventoryItemId, safeQuantity, context, details });
      throw err;
    }
  } catch (e) {
    console.error('Failed to set quantity:', JSON.stringify(e.response?.errors?.[0]?.extensions, null, 2) || e.message, {
      inventoryItemId,
      quantity: safeQuantity,
      context,
    });
    throw e;
  }
}

export async function mutateInventoryQuantity(ctx) {
  const {inventory_item_id: inventoryItemId, amount: delta} = ctx.state;

  const query = `
    mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup {
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
    }
  `;
  const variables = {
    input: {
      reason: 'correction',
      name: 'available',
      changes: [
        {
          inventoryItemId,
          locationId,
          delta,
        },
      ],
    },
  };

  try {
    const response = await requestWithThrottle(query, variables);
    ;

    if (response.inventoryAdjustQuantities.userErrors?.length) {
      ctx.log.status = 'error';
      ctx.log.reason = response.inventoryAdjustQuantities.userErrors;
    } else {
      ctx.log.status = 'success';
      ctx.log.reason = `Inventory adjusted: ${delta}`;
    }
    CacheManager.updateLogById(ctx.log);
  } catch (error) {
    ctx.log.status = 'error';
    ctx.log.reason = error.response?.errors || error.message;
    CacheManager.updateLogById(ctx.log);
    throw error;
  }
}

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
