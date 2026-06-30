import { beforeEach, describe, expect, it, jest } from '@jest/globals';

class FakeRedis {
  constructor() {
    this.kv = new Map();
  }

  async set(key, value, mode, ex, ttl) {
    if (mode === 'NX') {
      if (this.kv.has(key)) return null;
      this.kv.set(key, value);
      return 'OK';
    }
    this.kv.set(key, value);
    return 'OK';
  }

  async get(key) {
    return this.kv.get(key) ?? null;
  }

  async del(key) {
    return this.kv.delete(key) ? 1 : 0;
  }

  async eval(script, _numKeys, key, workerId, ttl) {
    const current = this.kv.get(key) ?? null;
    if (script.includes('DEL')) {
      if (current === workerId) {
        this.kv.delete(key);
        return 1;
      }
      return 0;
    }

    if (script.includes('EXPIRE')) {
      if (current === workerId) {
        return Number(ttl) > 0 ? 1 : 0;
      }
      return 0;
    }

    return 0;
  }

  // no-op methods for module compatibility
  async zadd() {}
  async zremrangebyscore() {}
  async zrevrange() { return []; }
  async mget() { return []; }
  async zrem() {}
  async rpush() {}
  async brpoplpush() { return null; }
  async lrem() {}
  async lrange() { return []; }
  async exists() { return 0; }
  async expire() {}
  async hgetall() { return {}; }
  async hset() {}
  async hget() { return null; }
  async scan() { return ['0', []]; }
}

describe('RedisManager lock semantics', () => {
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

  it('acquireLock succeeds only once for same SKU', async () => {
    const first = await RedisManager.acquireLock('SKU-1', 'worker-a', 30);
    const second = await RedisManager.acquireLock('SKU-1', 'worker-b', 30);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('releaseLock is owner-safe and atomic', async () => {
    await RedisManager.acquireLock('SKU-2', 'worker-a', 30);

    const wrongOwnerRelease = await RedisManager.releaseLock('SKU-2', 'worker-b');
    expect(wrongOwnerRelease).toBe(false);
    expect(await fakeRedis.get('lock:sku:SKU-2')).toBe('worker-a');

    const correctOwnerRelease = await RedisManager.releaseLock('SKU-2', 'worker-a');
    expect(correctOwnerRelease).toBe(true);
    expect(await fakeRedis.get('lock:sku:SKU-2')).toBeNull();
  });

  it('extendLock works only for owner', async () => {
    await RedisManager.acquireLock('SKU-3', 'worker-a', 30);

    const wrongOwnerExtend = await RedisManager.extendLock('SKU-3', 'worker-b', 30);
    const correctOwnerExtend = await RedisManager.extendLock('SKU-3', 'worker-a', 30);

    expect(wrongOwnerExtend).toBe(false);
    expect(correctOwnerExtend).toBe(true);
  });
});
