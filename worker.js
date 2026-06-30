import 'dotenv/config';
import { startQueueWorker } from './services/queue2.service.js';
import { useStore } from './store/useStore.js';
import { RedisManager } from './store/redis.manger.js';

// Окремий процес воркера. Запускаємо чергу та (опційно) прогрів SKU-кешу тут,
// щоб важкий повний скан каталогу Shopify і обробка задач більше не голодували
// event-loop API-процесу, який віддає відповіді на вебхуки Altegio.
startQueueWorker();

if (process.env.WARMUP_ON_START === 'true') {
  setTimeout(async () => {
    try {
      await RedisManager.clearDoubles();
      await useStore().getShopifyInventoryIdsBySku();
      console.log('Cashing done.');
    } catch (e) {
      console.warn('Warmup failed:', e?.message || e);
    }
  }, 30000);
}
