import { addIdsToQueue, getQueueMetrics } from './queue2.service.js';
import { CONFIG } from '../utils/config.js';
import { fetchProductsPage } from './altegio.service.js';

const PAGE_SIZE = 200;
const MAX_PAGES = 500; // safety guard
let fullSyncPromise = null;
let fullSyncState = {
  active: false,
  total: 0,
  startedAt: null,
  completedAt: null,
};

function extractGoodsArray(payload) {
  const candidates = [
    payload?.data?.data,
    payload?.data?.items,
    payload?.data?.goods,
    payload?.data,
    payload?.items,
    payload?.goods,
    payload,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function filterGoodsForStorage(goods, storageId) {
  return goods.filter((good) => {
    if (!good || typeof good.id === 'undefined') return false;
    if (!Array.isArray(good.actual_amounts)) return true; // keep if no amounts provided

    return good.actual_amounts.some((a) => a?.storage_id === storageId);
  });
}

export async function collectGoodsForFullSync() {
  let page = 1;
  const uniqueIds = new Set();

  while (page <= MAX_PAGES) {
    const pagePayload = await fetchProductsPage(CONFIG.altegio.companyId, { page, count: PAGE_SIZE });
    const rawGoods = extractGoodsArray(pagePayload);
    const goods = filterGoodsForStorage(rawGoods, CONFIG.altegio.storageId);

    goods.forEach((good) => uniqueIds.add(good.id));

    if (rawGoods.length < PAGE_SIZE) break;
    page += 1;
  }

  return [...uniqueIds];
}

export function isFullSyncInProgress() {
  return Boolean(fullSyncPromise);
}

export async function syncAllStocks() {
  if (fullSyncPromise) return fullSyncPromise;

  fullSyncPromise = (async () => {
    const goodIds = await collectGoodsForFullSync();
    fullSyncState = {
      active: goodIds.length > 0,
      total: goodIds.length,
      startedAt: goodIds.length > 0 ? new Date().toISOString() : null,
      completedAt: null,
    };

    if (goodIds.length === 0) {
      return { queued: 0, total: 0 };
    }

    await addIdsToQueue(goodIds);
    return { queued: goodIds.length, total: goodIds.length };
  })();

  try {
    return await fullSyncPromise;
  } finally {
    fullSyncPromise = null;
  }
}

export async function getFullSyncProgress() {
  const queueMetrics = await getQueueMetrics();
  const remaining = queueMetrics.uniqueInQueue + queueMetrics.processing;
  const total = fullSyncState.total || remaining;
  const completed = total > 0 ? Math.max(total - remaining, 0) : 0;

  let status = 'idle';
  if (fullSyncState.active || remaining > 0) {
    status = 'running';
  }

  if (status === 'running' && fullSyncState.active && remaining === 0) {
    status = 'completed';
  }

  if (status === 'completed') {
    fullSyncState = {
      ...fullSyncState,
      active: false,
      completedAt: fullSyncState.completedAt || new Date().toISOString(),
    };
  }

  return {
    status,
    total,
    completed,
    remaining,
    startedAt: fullSyncState.startedAt,
    completedAt: fullSyncState.completedAt,
    queue: queueMetrics,
  };
}
