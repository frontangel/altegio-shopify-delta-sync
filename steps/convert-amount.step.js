export function convertAmountStep(ctx) {
  if (ctx.input.status === 'create') {
    ctx.state.amount = ctx.input.rawAmount
  } else if (ctx.input.status === 'delete') {
    ctx.state.amount = -ctx.input.rawAmount
  }
}
