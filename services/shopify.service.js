import { GraphQLClient } from 'graphql-request';
import { useUtils } from '../utils/index.js';
const { sleep } = useUtils()

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

export async function getProducts(cursor = null) {
  const query = `
    query($cursor: String) {
      products(first: 250, after: $cursor, sortKey: ID) {
        pageInfo {
          hasNextPage
          endCursor
        }
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
                  metafields(first: 50, namespace: "custom") {
                    edges {
                      node {
                        key
                        value
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  return await shopify.request(query, {cursor});
}

export async function fetchAllProducts() {
  let all = [];
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    console.info('🔄 fetching products...')
    const data = await getProducts(cursor);
    const edges = data.products.edges;
    all.push(...edges);

    hasNext = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
    await sleep(1000)
  }
  console.log(`📦 ${all.length} products fetched`)
  return all;
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
    const data = await shopify.request(query, {id: inventoryItemId});
    return data.inventoryItem;
  } catch (error) {
    console.error('Failed to fetch inventory item:', error.response?.errors || error.message);
    throw error;
  }
}

export async function mutateInventoryQuantity(inventoryItemId, delta) {
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
    const response = await shopify.request(query, variables);

    if (response.inventoryAdjustQuantities.userErrors?.length) {
      console.warn('⚠ Shopify returned userErrors:', response.inventoryAdjustQuantities.userErrors);
    }
    console.log('✅ Inventory adjusted:', delta);
    return response;
  } catch (error) {
    console.error('❌ Failed to adjust inventory:', error.response?.errors || error.message);
    throw error;
  }
}
