import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.ALTEGIO_WEBHOOK_SECRET;
const WEBHOOK_SECURITY_ENABLED = process.env.WEBHOOK_SECURITY_ENABLED === 'true';

export function verifyWebhookSignature(payload, signature) {
  if (!WEBHOOK_SECURITY_ENABLED) {
    return true; // Security disabled
  }

  if (!WEBHOOK_SECRET) {
    console.warn('⚠️ ALTEGIO_WEBHOOK_SECRET not set, skipping signature verification');
    return true;
  }

  if (!signature) {
    return false; // No signature provided
  }

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export function webhookSecurityMiddleware(req, res, next) {
  if (!WEBHOOK_SECURITY_ENABLED) {
    return next();
  }

  const signature = req.headers['x-altegio-signature'] || req.headers['x-webhook-signature'];

  if (!signature) {
    console.warn('⚠️ Webhook received without signature');
    return res.status(403).json({ error: 'Missing webhook signature' });
  }

  const isValid = verifyWebhookSignature(req.body, signature);

  if (!isValid) {
    console.error('❌ Invalid webhook signature');
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }

  next();
}
