const ALTEGIO_STORAGE_ID = parseInt(process.env.ALTEGIO_STORAGE_ID || '2557508', 10);

export function getProductIdsStep(ctx) {
  if (ctx.input.resource === 'record') {
    ctx.state.product_ids = ctx.input.data.goods_transactions
      .filter(g => g.storage_id === ALTEGIO_STORAGE_ID)
      .map(g => g.good_id)
  } else {
    ctx.state.product_ids = [ctx.input.data.good.id]
  }
}
