import crypto from 'crypto';
import { describe, expect, it, beforeEach } from '@jest/globals';
import { verifyWebhookSignature, webhookSecurityMiddleware } from '../utils/webhookSecurity.js';

describe('webhookSecurity', () => {
  beforeEach(() => {
    process.env.WEBHOOK_SECURITY_ENABLED = 'true';
    process.env.ALTEGIO_WEBHOOK_SECRET = 'top-secret';
  });

  it('verifies valid signatures for raw payload', () => {
    const payload = '{"b":1,"a":2}';
    const signature = crypto
      .createHmac('sha256', process.env.ALTEGIO_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    const result = verifyWebhookSignature(payload, signature);
    expect(result).toBe(true);
  });

  it('rejects invalid signatures', () => {
    const payload = '{"a":1}';
    const result = verifyWebhookSignature(payload, 'deadbeef');
    expect(result).toBe(false);
  });

  it('middleware validates against rawBody, not re-serialized body', () => {
    const rawPayload = '{"b":1,"a":2}';
    const signature = crypto
      .createHmac('sha256', process.env.ALTEGIO_WEBHOOK_SECRET)
      .update(rawPayload)
      .digest('hex');

    const req = {
      rawBody: rawPayload,
      body: { a: 2, b: 1 },
      headers: {
        'x-altegio-signature': signature
      }
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      }
    };

    const next = jest.fn();
    webhookSecurityMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
