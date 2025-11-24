import test from 'node:test';
import assert from 'node:assert/strict';

const baseEnv = {
  ALTEGIO_COMPANY_ID: '101',
  ALTEGIO_STORAGE_ID: '202',
  ALTEGIO_TOKEN: 'token',
  ALTEGIO_USER_TOKEN: 'user-token',
  SF_API_VERSION: '2025-01',
  SF_DOMAIN: 'example.myshopify.com',
  SF_ADMIN_ACCESS_TOKEN: 'shpca_token',
  SF_CONST_LOCATION_ID: 'gid://shopify/Location/1',
};

async function loadConfig(overrides = {}) {
  const originalEnv = process.env;
  process.env = { ...process.env, ...baseEnv, ...overrides };
  const module = await import(`../utils/config.js?${Math.random()}`);
  process.env = originalEnv;
  return module.CONFIG;
}

test('parses numeric-like strings and applies defaults', async () => {
  const config = await loadConfig({ PORT: '4001', SKU_REFRESH_INTERVAL_MS: '60000', IDEMPOTENCY_TTL_MS: '120000' });
  assert.equal(config.server.port, 4001);
  assert.equal(config.server.refreshIntervalMs, 60000);
  assert.equal(config.webhook.idempotencyTtlMs, 120000);
  assert.equal(config.queue.backoffBaseMs, 1500); // default
});

test('uses fallbacks for legacy environment variable names', async () => {
  const config = await loadConfig({
    ALTEGIO_COMPANY_ID: undefined,
    ALTEGIO_STORAGE_ID: undefined,
    ALTEGIO_TOKEN: undefined,
    ALTEGIO_USER_TOKEN: undefined,
    ALTEGION_COMPANY_ID: '303',
    ALTEGION_STORAGE_ID: '404',
    ALTEGION_TOKEN: 'legacy-token',
    ALTEGION_USER_TOKEN: 'legacy-user-token',
  });

  assert.equal(config.altegio.companyId, 303);
  assert.equal(config.altegio.storageId, 404);
  assert.equal(config.altegio.partnerToken, 'legacy-token');
  assert.equal(config.altegio.userToken, 'legacy-user-token');
});
