export function skipUpdateStatus(ctx) {
  if (ctx.input.status === 'update') {
    ctx.log.status = 'skipped'
    ctx.log.reason = 'Skip by status: update'
    ctx.done = true
  }
}
