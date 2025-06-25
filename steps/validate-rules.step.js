export function validateRulesStep(ctx) {
  if (!ctx.rule) {
    ctx.log.status = 'skipped'
    ctx.log.reason = 'Skip by undefined rule'
    ctx.done = true
  }

  if (!ctx.done && ctx.rule.skipStatus?.length && ctx.rule.skipStatus.includes(ctx.input.status)) {
    ctx.log.status = 'skipped'
    ctx.log.reason = `Skip by status: ${ctx.input.status}`
    ctx.done = true
  }

  if (!ctx.done && ctx.rule.onlyStatus?.length && !ctx.rule.onlyStatus.includes(ctx.input.status)) {
    ctx.log.status = 'skipped'
    ctx.log.reason = `Skip by status: ${ctx.input.status}`
    ctx.done = true
  }

  if (!ctx.done && ctx.rule.onlyPaidFull && ctx.input.data.paid_full !== ctx.rule.onlyPaidFull) {
    ctx.log.status = 'skipped'
    ctx.log.reason = `Skip by paid_full`
    ctx.done = true
  }

  if (!ctx.done && ctx.rule.type && ctx.rule.type !== ctx.input.data.type) {
    ctx.log.status = 'skipped'
    ctx.log.reason = 'Skip by type'
    ctx.done = true
  }

  if (!ctx.done && typeof ctx.rule.type_id === 'number' && ctx.rule.type_id !== ctx.input.data.type_id) {
    ctx.log.status = 'skipped'
    ctx.log.reason = 'Skip by type id'
    ctx.done = true
  }

  if (!ctx.done && ctx.rule.onlyStorageId && ctx.rule.onlyStorageId !== ctx.input.data.storage.id) {
    ctx.log.status = 'skipped'
    ctx.log.reason = 'Skip by storageId'
    ctx.done = true
  }
}
