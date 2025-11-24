import { z } from 'zod';
import { CONFIG } from '../utils/config.js';

const resourceSchema = z.enum([
  'goods_operations_sale',
  'goods_operations_receipt',
  'goods_operations_stolen',
  'goods_operations_move',
  'record',
]);

const baseSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  resource: resourceSchema,
  status: z.string(),
  data: z.object({
    type: z.string().optional(),
    type_id: z.number().optional(),
    paid_full: z.number().optional(),
    storage: z.object({ id: z.number() }).optional(),
    good: z.object({ id: z.number() }).optional(),
    goods_transactions: z
      .array(
        z.object({
          storage_id: z.number(),
          good_id: z.number(),
        })
      )
      .optional(),
  }),
});

export function validateWebhookPayloadStep(ctx) {
  const parsed = baseSchema.safeParse(ctx.input);
  if (!parsed.success) {
    ctx.error = true;
    ctx.log.status = 'error';
    ctx.log.reason = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    return;
  }

  const payload = parsed.data;

  if (payload.resource === 'record') {
    if (!payload.data.goods_transactions || payload.data.goods_transactions.length === 0) {
      ctx.error = true;
      ctx.log.status = 'error';
      ctx.log.reason = 'goods_transactions list is required for record resource';
      return;
    }
  } else {
    if (!payload.data.storage?.id) {
      ctx.error = true;
      ctx.log.status = 'error';
      ctx.log.reason = 'storage.id is required';
      return;
    }
    if (!payload.data.good?.id) {
      ctx.error = true;
      ctx.log.status = 'error';
      ctx.log.reason = 'good.id is required';
      return;
    }
  }

  ctx.input = payload;
  ctx.eventId = payload.id ?? payload.data?.id ?? null;
  ctx.log.company_id = CONFIG.altegio.companyId;
  ctx.log.storage_id = payload.data.storage?.id ?? null;
}
