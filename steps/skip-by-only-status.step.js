export function skipByOnlyStatusStep(ctx) {
  if (ctx.rule.onlyStatus && ctx.rule.onlyStatus !== ctx.input.status) {
    ctx.log.status = 'skipped'
    ctx.log.reason = `Skip by status: ${status}`
    ctx.done = true
  }
}
