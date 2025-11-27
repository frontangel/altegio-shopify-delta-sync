import { RedisManager } from '../store/redis.manger.js';

export async function getInventoryItemIdStep (ctx) {
  try {
    const inventoryItemId = await RedisManager.getSkuMapping(ctx.state.altegio_sku)
    if (!inventoryItemId) {
      ctx.log.status = 'skipped'
      ctx.log.reason = 'Inventory item Id not found'
      ctx.done = true
    } else {
      ctx.state.inventory_item_id = ctx.log.inventory_item_id = inventoryItemId
    }
  } catch (err) {
    throw err
  }
}
