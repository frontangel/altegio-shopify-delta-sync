export function getProductIdsStep(ctx) {
  if (ctx.input.resource === 'record') {
    ctx.state.product_ids = ctx.input.data.goods_transactions.filter(g => g.storage_id === 2557508).map(g => g.good_id)
  } else {
    ctx.state.product_ids = [ctx.input.data.good.id]
  }
}
