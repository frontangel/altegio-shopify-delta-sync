export async function mutateInventoryQuantity(inventoryItemId, delta) {
  const mutation = `
    mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors {
          field
          message
        }
        inventoryAdjustmentGroup {
          createdAt
          reason
          referenceDocumentUri
          changes {
            name
            delta
          }
        }
      }
    }
  `;
  const input = {
    reason: "correction",
    changes: [
      {
        delta,
        inventoryItemId,
        locationId: process.env.SF_CONST_LOCATION_ID
      }
    ]
  };

  try {
    return await client.request(mutation, { input });
  } catch (error) {
    console.error('Failed to mutate inventory:', error);
    throw error;
  }
}
