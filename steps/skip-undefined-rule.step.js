export function skipUndefinedRuleStep(ctx) {
  if (!ctx.rule) {
    ctx.log.status = 'skipped'
    ctx.log.reason = 'Skip by undefined rule'
    ctx.done = true
  }
}
