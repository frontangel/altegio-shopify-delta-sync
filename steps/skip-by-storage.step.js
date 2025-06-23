export function skipByStorageStep(ctx) {
  if (ctx.rule.onlyStorageId && ctx.rule.onlyStorageId !== ctx.input.storage.id) {
    ctx.log.status = 'skipped'
    ctx.log.reason = 'Skip by storageId'
    ctx.done = true
  }
}
