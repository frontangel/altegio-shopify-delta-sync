import { CacheManager } from '../store/cache.manager.js';
import { CONFIG } from '../utils/config.js';
import crypto from 'crypto';

export function enforceIdempotencyStep(ctx) {
  const candidateId = ctx.eventId || ctx.input.event_id || ctx.input.data?.event_id || ctx.input.data?.id || null;
  const correlationId = candidateId ? String(candidateId) : crypto.randomUUID();

  ctx.eventId = candidateId;
  ctx.correlationId = correlationId;
  ctx.log.correlation_id = correlationId;

  if (!candidateId) return;

  if (CacheManager.isDuplicateEvent(candidateId)) {
    ctx.done = true;
    ctx.log.status = 'skipped';
    ctx.log.reason = `Duplicate webhook ${candidateId}`;
    return;
  }

  CacheManager.rememberEvent(candidateId, CONFIG.webhook.idempotencyTtlMs);
}
