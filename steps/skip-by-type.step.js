export function skipByTypeStep(ctx) {
  if (ctx.rule.type_id !== ctx.input.type_id || ctx.rule.type !== ctx.input.type) {
    ctx.log.status = 'skipped'
    ctx.log.reason = 'Skip by type'
    ctx.done = true
  }
}
