# Опис проєкту та архітектури

## 1) Що це за проєкт

Це Node.js сервіс синхронізації залишків товарів між **Altegio** та **Shopify**.

Основна ідея:
- Altegio надсилає webhook про операції з товарами.
- Сервіс відфільтровує релевантні події.
- Для кожного товару ставиться задача в Redis-чергу.
- Фоновий worker забирає задачі, отримує актуальний залишок з Altegio і виставляє абсолютну кількість у Shopify.

Результат: Shopify тримається синхронним з Altegio по складу `ALTEGIO_STORAGE_ID`.

---

## 2) Технологічний стек

- `Express` (HTTP API + webhook endpoint)
- `ioredis` (черга, логи, мапінги SKU, idempotency, lock-и)
- `graphql-request` (Shopify Admin GraphQL API)
- `axios` (Altegio API)
- `EJS` (простий UI для help/logs)

Точка входу: [index.js](/Users/zslayer/Work/shopify/index.js)

---

## 3) Компоненти та відповідальність

### API шар (Express)

Файл: [index.js](/Users/zslayer/Work/shopify/index.js)

Відповідає за:
- прийом webhook: `POST /webhook`;
- basic auth для адмінських роутів;
- health/queue/logs/debug endpoints;
- запуск warmup кешу SKU при старті (`WARMUP_ON_START`).

### Обробка правил webhook

Файли:
- [steps/validate-rules.step.js](/Users/zslayer/Work/shopify/steps/validate-rules.step.js)
- [steps/get-product-ids.step.js](/Users/zslayer/Work/shopify/steps/get-product-ids.step.js)

Логіка:
- перевірка ресурсу, статусу, типу, storage, paid_full;
- витяг `product_ids` (для `record` бере `goods_transactions`, для інших подій `good.id`);
- нерелевантні webhook-и позначаються як `skipped`.

### Queue + worker

Файл: [services/queue2.service.js](/Users/zslayer/Work/shopify/services/queue2.service.js)

Логіка:
- нескінченний worker loop;
- атомарне переміщення задачі `queue:correction -> queue:processing`;
- retry до `MAX_RETRIES=3`;
- dead-letter queue після вичерпання ретраїв;
- recovery “завислих” задач із `processing`.

### Redis manager (операційний шар)

Файл: [store/redis.manger.js](/Users/zslayer/Work/shopify/store/redis.manger.js)

Відповідає за:
- webhook logs (TTL 3 дні);
- черги (`queue:correction`, `queue:processing`, `queue:dead_letter`);
- idempotency ключі (TTL 24 години);
- distributed lock по SKU (`lock:sku:*`);
- мапінг `SKU -> inventoryItemId`, article-мапінг, пошук дублікатів SKU.

### Shopify інтеграція

Файл: [services/shopify.service.js](/Users/zslayer/Work/shopify/services/shopify.service.js)

Відповідає за:
- читання товарів/варіантів з Shopify (для warmup мапінгу);
- `inventorySetQuantities` (абсолютна кількість);
- throttle/network retry + backoff;
- опціональна верифікація фактичної кількості після апдейту.

### Altegio інтеграція

Файл: [services/altegio.service.js](/Users/zslayer/Work/shopify/services/altegio.service.js)

Відповідає за:
- отримання товару по `companyId + productId`;
- retry/backoff для мережевих/5xx помилок;
- повернення `article` і `actual_amounts` для розрахунку залишку.

### Ініціалізація SKU-кешу

Файл: [store/useStore.js](/Users/zslayer/Work/shopify/store/useStore.js)

Робить:
- повне читання активних Shopify продуктів;
- витяг `metafield(custom.sku_from_altegio)`;
- заповнення Redis-мапінгу `sku_mapper`;
- збереження SKU-дублікатів у `double_mapper`;
- підготовка readiness state для middleware `waitUntilReady`.

---

## 4) Як проходить один webhook (end-to-end)

1. Altegio відправляє `POST /webhook`.
2. `webhookSecurityMiddleware` (якщо увімкнено) перевіряє HMAC підпис.
3. `validateRulesStep` вирішує: обробляти або `skip`.
4. `getProductIdsStep` формує список товарів.
5. Для кожного товару створюється задача в Redis-черзі.
6. Worker забирає задачу в `processing`.
7. Worker тягне товар з Altegio, бере SKU і залишок для потрібного складу.
8. Worker бере lock на SKU, знаходить `inventoryItemId` в Redis-мапінгу.
9. Викликає Shopify mutation на встановлення абсолютної кількості.
10. Опційно перевіряє (verify) фактичну кількість у Shopify.
11. Позначає webhook log (`success`, `warning`, `error`, `skipped`).
12. Завершує задачу або переводить у retry/dead-letter.

---

## 5) Дані в Redis

Ключові структури:
- `webhook_logs:*` - логи webhook-ів (TTL 3 дні)
- `queue:correction` - нові/повторні задачі
- `queue:processing` - задачі в роботі
- `queue:dead_letter` - остаточно провалені задачі
- `idempotency:*` - захист від повторної обробки
- `lock:sku:*` - блокування конкурентних апдейтів по SKU
- `sku_mapper` - відповідність `altegio_sku -> shopify inventoryItemId`
- `article_mapper` - кеш `goodId -> article`
- `double_mapper` - SKU, що мапляться на >1 inventory item

---

## 6) Операційні endpoints

Публічні:
- `POST /webhook`
- `GET /healthz`

Під Basic Auth:
- `GET /queue`, `/queue/processing`, `/queue/dead-letter`
- `GET /logs`
- `GET /sync/:id?q=...` (manual sync через чергу)
- `GET /db`, `GET /double`, `GET /sku`

Dev-only:
- `GET /debug/redis/flush` (тільки якщо `NODE_ENV=development`)

---

## 7) Сильні сторони поточної реалізації

- Надійна queue-модель через atomic move в processing.
- Є retry, dead-letter та recovery stale tasks.
- Є idempotency і distributed lock на SKU.
- Є warmup мапінгу SKU і базова операційна діагностика через endpoints.

---

## 8) Слабкі місця (ризики)

1. **Перевірка webhook-підпису потенційно некоректна.**
`webhookSecurityMiddleware` підписує `req.body` після JSON парсингу, а не сире тіло запиту. Для HMAC це часто дає false-negative/false-positive залежно від серіалізації.

2. **Lock TTL фіксований (30с) без стабільного продовження під час довгих операцій.**
Якщо запит до зовнішніх API затягнеться, lock може протухнути і паралельний worker візьме той самий SKU.

3. **`releaseLock` реалізований через `GET` + `DEL` (не атомарно).**
Між цими операціями lock може змінити власника. Без Lua compare-and-delete є race condition.

4. **Навантаження на Redis при читанні логів.**
`getWebhookLogs` використовує `SCAN` + `MGET` по патерну; на великих об’ємах це може бути дорогим та непередбачуваним по latency.

5. **Warmup SKU може бути довгим і “важким”.**
Повний обхід активних товарів Shopify на старті впливає на час готовності і може впиратись у rate limits на великих каталогах.

6. **Manual sync створює спеціальний формат задачі (`manual:...`), але worker очікує `goodId`.**
Це ризик неконсистентної обробки або помилок, якщо ручний сценарій реально використовується.

7. **Обмежене тестове покриття в поточному репозиторії.**
У `package.json` є скрипти `jest`, але каталогу `tests/` у цій копії проєкту немає; критичні сценарії черги/ретраїв/lock-ів виглядають нетестованими на рівні коду в репозиторії.

8. **Single-process worker усередині веб-процесу.**
Немає окремого процесу/оркестрації worker-а; падіння процесу одночасно “валить” і API, і обробку черги.
