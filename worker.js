import 'dotenv/config';
import { startQueueWorker } from './services/queue2.service.js';
import { startReconcileScheduler } from './services/reconcile.service.js';
import { useStore } from './store/useStore.js';

// Окремий процес воркера. Запускаємо чергу та (опційно) прогрів SKU-кешу тут,
// щоб важкий повний скан каталогу Shopify і обробка задач більше не голодували
// event-loop API-процесу, який віддає відповіді на вебхуки Altegio.
startQueueWorker();

const { getShopifyInventoryIdsBySku } = useStore();

// Мапінг Altegio article → Shopify inventoryItemId раніше будувався лише при
// старті воркера, тож товари, додані в Shopify між деплоями, не синхронізувались
// місяцями. Тепер оновлюємо його періодично.
const SKU_REFRESH_INTERVAL_MS = Number(process.env.SKU_REFRESH_INTERVAL_MS) || 60 * 60 * 1000;

if (process.env.WARMUP_ON_START === 'true') {
  setTimeout(async () => {
    try {
      await getShopifyInventoryIdsBySku();
      console.log('Cashing done.');
    } catch (e) {
      console.warn('Warmup failed:', e?.message || e);
    }
  }, 30000);
}

setInterval(() => {
  getShopifyInventoryIdsBySku().catch(e => console.warn('SKU mapping refresh failed:', e?.message || e));
}, SKU_REFRESH_INTERVAL_MS);

startReconcileScheduler();
