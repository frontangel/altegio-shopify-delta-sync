import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('queue2 manual task processing', () => {
  let processNextId;
  let ShopifyService;
  let RedisManager;
  let AltegioService;
  let refreshSkuMappingIfStale;

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
    AltegioService = {
      fetchProduct: jest.fn().mockResolvedValue({
        data: { article: '524105', actual_amounts: [{ storage_id: 2557508, amount: 1 }] }
      })
    };
    refreshSkuMappingIfStale = jest.fn().mockResolvedValue(false);

    jest.unstable_mockModule('../services/altegio.service.js', () => AltegioService);
    jest.unstable_mockModule('../store/useStore.js', () => ({
      useStore: () => ({ refreshSkuMappingIfStale })
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

  it('refreshes a stale SKU mapping on miss and then syncs the good', async () => {
    RedisManager.getSkuMapping = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('gid://shopify/InventoryItem/new');
    refreshSkuMappingIfStale.mockResolvedValue(true);
    ShopifyService.verifyQuantity.mockResolvedValue({ verified: true, actual: 1 });

    await processNextId({ hookId: 'hook-2', id: 23917730, retry: 0 });

    expect(refreshSkuMappingIfStale).toHaveBeenCalledTimes(1);
    expect(ShopifyService.setAbsoluteQuantity).toHaveBeenCalledWith('gid://shopify/InventoryItem/new', 1);
  });

  it('skips (without Shopify update) when SKU is still unmapped after refresh attempt', async () => {
    RedisManager.getSkuMapping = jest.fn().mockResolvedValue(null);
    refreshSkuMappingIfStale.mockResolvedValue(false);

    await processNextId({ hookId: 'hook-3', id: 23917730, retry: 0 });

    expect(refreshSkuMappingIfStale).toHaveBeenCalledTimes(1);
    expect(ShopifyService.setAbsoluteQuantity).not.toHaveBeenCalled();
    expect(RedisManager.updateLogWebhook).toHaveBeenCalledWith('hook-3', expect.objectContaining({
      status: 'skipped',
      reason: 'Inventory item id not found'
    }));
  });
});
