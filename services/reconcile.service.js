import * as AltegioService from './altegio.service.js';
import * as ShopifyService from './shopify.service.js';
import { RedisManager } from '../store/redis.manger.js';
import { useStore } from '../store/useStore.js';

// Повна звірка залишків Altegio → Shopify.
//
// Вебхуки дають дельти «по події»; якщо подію втрачено (не було мапінгу SKU,
// правило відсіяло, Altegio не надіслав) — розбіжність живе вічно. Reconcile
// порівнює весь каталог і для кожної розбіжності ставить у чергу звичайну
// webhook-задачу по goodId: воркер сам перечитує актуальний залишок з Altegio
// і виставляє його в Shopify абсолютним значенням (Altegio — джерело правди).

const ALTEGIO_COMPANY_ID = process.env.ALTEGIO_COMPANY_ID || '1275575';
const ALTEGIO_STORAGE_ID = parseInt(process.env.ALTEGIO_STORAGE_ID || '2557508', 10);
const RECONCILE_ENABLED = process.env.RECONCILE_ENABLED !== 'false';
const RECONCILE_HOUR = parseInt(process.env.RECONCILE_HOUR || '3', 10); // за Києвом
const RECONCILE_TIMEZONE = 'Europe/Kyiv';
const SCHEDULER_TICK_MS = 5 * 60 * 1000;

// Та сама нормалізація, що й у воркері (queue2.toShopifyQuantity): дробові
// залишки Altegio округлюємо вниз — інакше вічна «розбіжність» 29.6 vs 29.
function altegioQuantity(good, storageId) {
  const amounts = Array.isArray(good?.actual_amounts) ? good.actual_amounts : [];
  const n = Number(amounts.find(a => Number(a?.storage_id) === storageId)?.amount ?? 0);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/**
 * Чиста функція порівняння — без мережі, щоб її можна було тестувати.
 * @param {Array} goods    товари Altegio ({ good_id, article, title, actual_amounts })
 * @param {Array} variants варіанти Shopify ({ altegioSku, inventoryItemId, available, title })
 */
export function computeReconcileDiffs(goods, variants, storageId = ALTEGIO_STORAGE_ID) {
  const byArticle = new Map();
  for (const good of goods || []) {
    const article = typeof good?.article === 'string' ? good.article.trim() : String(good?.article ?? '').trim();
    if (!article) continue;
    if (!byArticle.has(article)) byArticle.set(article, []);
    byArticle.get(article).push(good);
  }

  const diffs = [];
  const notInAltegio = [];
  const ambiguous = [];
  const notStocked = [];

  for (const variant of variants || []) {
    const matches = byArticle.get(variant.altegioSku) || [];
    if (matches.length === 0) {
      notInAltegio.push({ sku: variant.altegioSku, title: variant.title });
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push({ sku: variant.altegioSku, goodIds: matches.map(g => g.good_id) });
      continue;
    }
    if (variant.available === null || variant.available === undefined) {
      notStocked.push({ sku: variant.altegioSku, title: variant.title });
      continue;
    }

    const good = matches[0];
    const altegio = Number(altegioQuantity(good, storageId));
    const shopify = Number(variant.available);
    if (altegio !== shopify) {
      diffs.push({
        sku: variant.altegioSku,
        goodId: good.good_id,
        inventoryItemId: variant.inventoryItemId,
        title: variant.title || good.title,
        altegio,
        shopify,
        delta: shopify - altegio
      });
    }
  }

  diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    checked: (variants || []).length,
    diffs,
    notInAltegio,
    ambiguous,
    notStocked
  };
}

let running = null;

export async function runReconcile({ dryRun = true, trigger = 'manual' } = {}) {
  if (running) {
    throw new Error('Reconcile is already running');
  }

  running = (async () => {
    const startedAt = Date.now();

    if (!dryRun) {
      // Воркер шукає inventoryItemId через Redis-мапінг — оновлюємо його,
      // щоб нові/змінені в Shopify товари не були пропущені.
      await useStore().getShopifyInventoryIdsBySku();
    }

    const [goods, variants] = await Promise.all([
      AltegioService.fetchAllGoods(ALTEGIO_COMPANY_ID),
      ShopifyService.fetchAllVariantStock()
    ]);

    const result = computeReconcileDiffs(goods, variants, ALTEGIO_STORAGE_ID);

    let queued = 0;
    if (!dryRun) {
      const queuedGoods = new Set();
      for (const diff of result.diffs) {
        if (queuedGoods.has(diff.goodId)) continue;
        queuedGoods.add(diff.goodId);

        const hookId = await RedisManager.setWebhookLogs({
          status: 'waiting',
          type: 'reconcile',
          resource: 'reconcile',
          reason: `Reconcile ${diff.sku}: Shopify ${diff.shopify} → Altegio ${diff.altegio}`,
          json: JSON.stringify({ trigger, ...diff })
        });
        await RedisManager.setQueue(hookId, diff.goodId);
        queued += 1;
      }
    }

    const summary = {
      at: startedAt,
      trigger,
      dryRun,
      durationMs: Date.now() - startedAt,
      altegioGoods: goods.length,
      checked: result.checked,
      diffs: result.diffs.length,
      queued, // поставлено в чергу воркера, а не вже записано в Shopify
      notInAltegio: result.notInAltegio.length,
      ambiguous: result.ambiguous.length,
      notStocked: result.notStocked.length
    };

    await RedisManager.setReconcileSummary(summary);
    console.log('[Reconcile] done', summary);

    return { summary, ...result };
  })();

  try {
    return await running;
  } finally {
    running = null;
  }
}

function kyivNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: RECONCILE_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date()).map(p => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function startReconcileScheduler() {
  if (!RECONCILE_ENABLED) {
    console.log('[Reconcile] nightly scheduler disabled (RECONCILE_ENABLED=false)');
    return;
  }

  console.log(`[Reconcile] nightly scheduler on: ${String(RECONCILE_HOUR).padStart(2, '0')}:00 ${RECONCILE_TIMEZONE}`);

  const tick = async () => {
    try {
      const { date, hour } = kyivNow();
      if (hour !== RECONCILE_HOUR) return;
      if (!(await RedisManager.claimReconcileRun(date))) return;
      await runReconcile({ dryRun: false, trigger: 'nightly' });
    } catch (err) {
      console.error('[Reconcile] nightly run failed:', err?.message || err);
    }
  };

  setInterval(tick, SCHEDULER_TICK_MS);
}
