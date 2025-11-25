import { addIdsToQueue } from './queue2.service.js';
import { CONFIG } from '../utils/config.js';
import { fetchProductsPage } from './altegio.service.js';

const PAGE_SIZE = 200;
const MAX_PAGES = 500; // safety guard
let fullSyncPromise = null;

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
    const goods = filterGoodsForStorage(extractGoodsArray(pagePayload), CONFIG.altegio.storageId);

    goods.forEach((good) => uniqueIds.add(good.id));

    if (goods.length < PAGE_SIZE) break;
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
