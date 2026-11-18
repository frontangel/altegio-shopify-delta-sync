import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const STORAGE = 2557508;

describe('computeReconcileDiffs', () => {
  let computeReconcileDiffs;

  beforeEach(async () => {
    jest.resetModules();
    jest.unstable_mockModule('../services/redis.js', () => ({
      __esModule: true,
      default: {},
      isRedisReady: () => true
    }));
    jest.unstable_mockModule('../services/altegio.service.js', () => ({ fetchAllGoods: jest.fn(), fetchProduct: jest.fn() }));
    jest.unstable_mockModule('../services/shopify.service.js', () => ({ fetchAllVariantStock: jest.fn(), fetchAllProducts: jest.fn() }));
    ({ computeReconcileDiffs } = await import('../services/reconcile.service.js'));
  });

  const good = (good_id, article, amount, storage_id = STORAGE) => ({
    good_id,
    article,
    title: `good ${good_id}`,
    actual_amounts: [{ storage_id, amount }, { storage_id: 1, amount: 999 }]
  });
  const variant = (altegioSku, available, inventoryItemId = `inv-${altegioSku}`) => ({ altegioSku, available, inventoryItemId, title: altegioSku });

  it('reports a diff when Shopify differs from Altegio on our storage', () => {
    const res = computeReconcileDiffs([good(1, '524105', 1)], [variant('524105', 2)], STORAGE);
    expect(res.diffs).toEqual([
      expect.objectContaining({ sku: '524105', goodId: 1, inventoryItemId: 'inv-524105', altegio: 1, shopify: 2, delta: 1 })
    ]);
  });

  it('ignores matching quantities and other storages', () => {
    const res = computeReconcileDiffs([good(1, 'A', 5)], [variant('A', 5)], STORAGE);
    expect(res.diffs).toHaveLength(0);
    expect(res.checked).toBe(1);
  });

  it('treats a missing storage entry as zero stock in Altegio', () => {
    const res = computeReconcileDiffs([good(1, 'A', 5, 42)], [variant('A', 3)], STORAGE);
    expect(res.diffs[0]).toEqual(expect.objectContaining({ altegio: 0, shopify: 3 }));
  });

  it('also reports Shopify lower than Altegio (absolute sync both ways)', () => {
    const res = computeReconcileDiffs([good(1, 'A', 10)], [variant('A', 7)], STORAGE);
    expect(res.diffs[0].delta).toBe(-3);
  });

  it('classifies unmapped, ambiguous and unstocked variants instead of diffing them', () => {
    const goods = [good(1, 'DUP', 1), good(2, 'DUP', 1), good(3, 'NOLEVEL', 1)];
    const variants = [variant('MISSING', 1), variant('DUP', 5), variant('NOLEVEL', null)];
    const res = computeReconcileDiffs(goods, variants, STORAGE);
    expect(res.diffs).toHaveLength(0);
    expect(res.notInAltegio.map(x => x.sku)).toEqual(['MISSING']);
    expect(res.ambiguous).toEqual([{ sku: 'DUP', goodIds: [1, 2] }]);
    expect(res.notStocked.map(x => x.sku)).toEqual(['NOLEVEL']);
  });

  it('trims Altegio articles and sorts diffs by magnitude', () => {
    const res = computeReconcileDiffs(
      [good(1, ' A ', 1), good(2, 'B', 100)],
      [variant('A', 2), variant('B', 76)],
      STORAGE
    );
    expect(res.diffs.map(d => d.sku)).toEqual(['B', 'A']);
  });

  it('rounds fractional Altegio stock down, like the worker does', () => {
    const res = computeReconcileDiffs([good(1, 'W', 29.6), good(2, 'X', 3.9)], [variant('W', 29), variant('X', 4)], STORAGE);
    expect(res.diffs).toEqual([expect.objectContaining({ sku: 'X', altegio: 3, shopify: 4 })]);
  });
});
