import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ALTEGIO_COMPANY_ID = '1';
process.env.ALTEGIO_STORAGE_ID = '10';
process.env.ALTEGIO_TOKEN = 'token';
process.env.ALTEGIO_USER_TOKEN = 'user-token';
process.env.SF_API_VERSION = '2025-01';
process.env.SF_DOMAIN = 'example.myshopify.com';
process.env.SF_ADMIN_ACCESS_TOKEN = 'shpca_token';
process.env.SF_CONST_LOCATION_ID = 'gid://shopify/Location/1';

import { validateWebhookPayloadStep } from '../steps/validate-webhook-payload.step.js';
import { enforceIdempotencyStep } from '../steps/enforce-idempotency.step.js';
import { validateRulesStep } from '../steps/validate-rules.step.js';
import { getProductIdsStep } from '../steps/get-product-ids.step.js';

function baseCtx(payload) {
  return {
    input: payload,
    state: { product_ids: [] },
    rules: {
      goods_operations_sale: { type_id: 1, skipStatus: ['update'], onlyStorageId: Number(process.env.ALTEGIO_STORAGE_ID) },
      record: { onlyStatus: 'update', onlyPaidFull: 1 },
    },
    log: {},
    error: false,
    done: false,
    get rule() {
      return this.rules[this.input?.resource];
    },
  };
}

test('rejects record payloads without goods_transactions', () => {
  const ctx = baseCtx({ resource: 'record', status: 'update', data: { type_id: 0 } });
  validateWebhookPayloadStep(ctx);
  assert.equal(ctx.error, true);
  assert.equal(ctx.log.reason, 'goods_transactions list is required for record resource');
});

test('collects product IDs filtered by storage id for record resource', () => {
  const ctx = baseCtx({
    resource: 'record',
    status: 'update',
    data: {
      goods_transactions: [
        { storage_id: 10, good_id: 7 },
        { storage_id: 99, good_id: 8 },
      ],
    },
  });

  validateWebhookPayloadStep(ctx);
  enforceIdempotencyStep(ctx);
  validateRulesStep(ctx);
  getProductIdsStep(ctx);

  assert.deepEqual(ctx.state.product_ids, [7]);
});

test('marks unknown resources explicitly', () => {
  const ctx = baseCtx({
    resource: 'unlisted_resource',
    status: 'create',
    data: { storage: { id: 10 }, good: { id: 5 } },
  });

  validateWebhookPayloadStep(ctx);
  enforceIdempotencyStep(ctx);
  validateRulesStep(ctx);

  assert.equal(ctx.done, true);
  assert.equal(ctx.log.status, 'unknown_resource');
  assert.match(ctx.log.reason, /unsupported resource/);
});
