import crypto from 'crypto';

function isWebhookSecurityEnabled() {
  return process.env.WEBHOOK_SECURITY_ENABLED === 'true';
}

function getWebhookSecret() {
  return process.env.ALTEGIO_WEBHOOK_SECRET;
}

export function verifyWebhookSignature(payload, signature, options = {}) {
  const securityEnabled = options.securityEnabled ?? isWebhookSecurityEnabled();
  const secret = options.secret ?? getWebhookSecret();
  if (!securityEnabled) {
    return true; // Security disabled
  }

  if (!secret) {
    console.warn('⚠️ ALTEGIO_WEBHOOK_SECRET not set, skipping signature verification');
    return true;
  }

  if (!signature || typeof signature !== 'string') {
    return false; // No signature provided
  }

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export function webhookSecurityMiddleware(req, res, next) {
  if (!isWebhookSecurityEnabled()) {
    return next();
  }

  const signature = req.headers['x-altegio-signature'] || req.headers['x-webhook-signature'];

  if (!signature) {
    console.warn('⚠️ Webhook received without signature');
    return res.status(403).json({ error: 'Missing webhook signature' });
  }

  // Validate signature against raw request body to avoid JSON re-serialization mismatches.
  const rawPayload = req.rawBody || JSON.stringify(req.body ?? {});
  const isValid = verifyWebhookSignature(rawPayload, signature);

  if (!isValid) {
    console.error('❌ Invalid webhook signature');
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }

  next();
}
