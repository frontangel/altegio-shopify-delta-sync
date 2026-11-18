import { beforeEach, describe, expect, it, jest } from '@jest/globals';

class FakeRedis {
  constructor() {
    this.kv = new Map();
    this.hashes = new Map();
  }
  async set(key, value) { this.kv.set(key, value); return 'OK'; }
  async get(key) { return this.kv.get(key) ?? null; }
  async hset(key, obj) {
    const h = this.hashes.get(key) ?? new Map();
    for (const [k, v] of Object.entries(obj)) h.set(k, v);
    this.hashes.set(key, h);
  }
  async hget(key, field) { return this.hashes.get(key)?.get(field) ?? null; }
  async hgetall(key) { return Object.fromEntries(this.hashes.get(key) ?? []); }
  async rename(from, to) {
    if (!this.hashes.has(from)) throw new Error('ERR no such key');
    this.hashes.set(to, this.hashes.get(from));
    this.hashes.delete(from);
    return 'OK';
  }
}

describe('RedisManager SKU mapping replacement', () => {
  let RedisManager;
  let fakeRedis;

  beforeEach(async () => {
    jest.resetModules();
    fakeRedis = new FakeRedis();
    jest.unstable_mockModule('../services/redis.js', () => ({
      __esModule: true,
      default: fakeRedis,
      isRedisReady: () => true
    }));
    ({ RedisManager } = await import('../store/redis.manger.js'));
  });

  it('replaces the whole mapping atomically and drops stale keys', async () => {
    await fakeRedis.hset('sku_mapper', { OLD: 'inv-old', KEEP: 'inv-keep-old' });

    const size = await RedisManager.replaceSkuMappings({ KEEP: 'inv-keep-new', NEW: 'inv-new' });

    expect(size).toBe(2);
    expect(await RedisManager.getSkuMapping('OLD')).toBeNull();
    expect(await RedisManager.getSkuMapping('KEEP')).toBe('inv-keep-new');
    expect(await RedisManager.getSkuMapping('NEW')).toBe('inv-new');
    // тимчасовий ключ не лишається
    expect([...fakeRedis.hashes.keys()]).toEqual(['sku_mapper']);
    expect(await RedisManager.getSkuMappingRefreshedAt()).toEqual(expect.any(Number));
  });

  it('does not wipe the mapping when Shopify returns nothing', async () => {
    await fakeRedis.hset('sku_mapper', { A: 'inv-a' });

    const size = await RedisManager.replaceSkuMappings({});

    expect(size).toBe(0);
    expect(await RedisManager.getSkuMapping('A')).toBe('inv-a');
    expect(await RedisManager.getSkuMappingRefreshedAt()).toBeNull();
  });
});
