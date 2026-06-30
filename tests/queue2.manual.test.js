import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('queue2 manual task processing', () => {
  let processNextId;
  let ShopifyService;
  let RedisManager;

  beforeEach(async () => {
    jest.resetModules();
    process.env.QUEUE_WORKER_AUTOSTART = 'false';
    process.env.SF_CONST_LOCATION_ID = 'gid://shopify/Location/1';
    process.env.ENABLE_SHOPIFY_VERIFICATION = 'true';

    ShopifyService = {
      setAbsoluteQuantity: jest.fn().mockResolvedValue({}),
      getInventoryItemById: jest.fn().mockResolvedValue({
        inventoryLevels: [
          {
            location: { id: 'gid://shopify/Location/1' },
            quantities: [{ name: 'available', quantity: 2 }]
          }
        ]
      }),
      verifyQuantity: jest.fn().mockResolvedValue({
        verified: true,
        actual: 5
      })
    };

    RedisManager = {
      checkIdempotency: jest.fn().mockResolvedValue(false),
      updateLogWebhook: jest.fn().mockResolvedValue(true),
      acquireLock: jest.fn().mockResolvedValue(true),
      extendLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(true),
      getSkuMapping: jest.fn().mockResolvedValue('unused-in-manual'),
      setIdempotency: jest.fn().mockResolvedValue(true)
    };

    jest.unstable_mockModule('../services/shopify.service.js', () => ShopifyService);
    jest.unstable_mockModule('../services/altegio.service.js', () => ({
      fetchProduct: jest.fn()
    }));
    jest.unstable_mockModule('../store/redis.manger.js', () => ({
      RedisManager
    }));
    jest.unstable_mockModule('../services/redis.js', () => ({
      __esModule: true,
      default: {},
      isRedisReady: () => true
    }));

    ({ processNextId } = await import('../services/queue2.service.js'));
  });

  it('processes manual task and updates Shopify with explicit quantity', async () => {
    const task = {
      taskType: 'manual',
      hookId: 'hook-1',
      sku: 'SKU-ABC',
      quantity: 5,
      inventoryItemId: 'gid://shopify/InventoryItem/123',
      retry: 0
    };

    await processNextId(task);

    expect(ShopifyService.setAbsoluteQuantity).toHaveBeenCalledWith('gid://shopify/InventoryItem/123', 5);
    expect(ShopifyService.verifyQuantity).toHaveBeenCalledWith('gid://shopify/InventoryItem/123', 5);
    expect(RedisManager.setIdempotency).toHaveBeenCalledTimes(1);
    expect(RedisManager.releaseLock).toHaveBeenCalledWith('SKU-ABC', expect.any(String));
  });
});
