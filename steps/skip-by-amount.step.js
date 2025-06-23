export function skipByAmountStep(ctx) {
  if (!ctx.state.amount || typeof ctx.state.amount !== 'number') {
    ctx.log.status = 'skipped'
    ctx.log.reason = `Skip by amount: ${ctx.state.amount}`
    ctx.done = true
  }
}
