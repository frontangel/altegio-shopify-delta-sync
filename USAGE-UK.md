# Швидкі інструкції користування

Цей документ коротко пояснює, як запустити сервіс синхронізації Altegio → Shopify і як ним користуватись.

## Вимоги
- Node.js 20+
- Доступ до Shopify Admin API (домен магазину та access token)
- Дані компанії/складу Altegio та токени (partner + user)

## Підготовка середовища
1. Скопіюйте `.env.example` (якщо є) або створіть `.env` у корені проєкту.
2. Заповніть змінні (мінімально необхідні):
   - `SF_DOMAIN`, `SF_ADMIN_ACCESS_TOKEN`, `SF_API_VERSION`, `SF_CONST_LOCATION_ID`
   - `ALTEGIO_COMPANY_ID`, `ALTEGIO_STORAGE_ID`, `ALTEGIO_TOKEN`, `ALTEGIO_USER_TOKEN`
   - Необовʼязково: `PORT`, `WARMUP_ON_START`, `SKU_REFRESH_INTERVAL_MS`, `BASIC_AUTH_USER`, `BASIC_AUTH_PASS`, `IDEMPOTENCY_TTL_MS`, `QUEUE_BACKOFF_BASE_MS`.
3. Встановіть залежності: `yarn install` або `npm install` (використовуйте один менеджер).

## Запуск
- Продакшн-подібний: `yarn start` або `npm start` — запускає Express-сервер на `PORT` (за замовчуванням 3000).
- Режим розробки: `yarn start:dev` або `npm run start:dev` — із автоматичним перезапуском (nodemon).

## Основні ендпоїнти
- `POST /webhook` — приймає вебхуки Altegio, ставить продукти у чергу на синхронізацію кількості в Shopify.
- `GET /healthz` — стан сервісу (`ready`, розмір кешу SKU).
- `GET /sku?sku=ABC-123` — повертає `inventoryItemId` у Shopify для переданого SKU (під базовою автентифікацією).
- `GET /db` — JSON дамп кешів (під базовою автентифікацією).
- `GET /logs` — HTML-лог останніх подій (під базовою автентифікацією).

## Робота черги
- Продукти ставляться у чергу (Redis або резервно локальний файл `store/pending-queue.json`).
- Кожні 2 секунди обробник забирає наступний `good_id` і оновлює кількість у Shopify.
- При помилці виконується експоненційний backoff та повторна спроба; успішні/пропущені події логуються.

## Типовий сценарій
1. Запускаєте сервіс (див. розділ «Запуск»).
2. Налаштовуєте вебхуки в Altegio, щоб вони надсилали події на `POST /webhook` вашого сервера.
3. Моніторите `GET /healthz` та сторінку `GET /logs` (з базовою автентифікацією, якщо увімкнено) для контролю стану.
4. За потреби перевіряєте відповідність SKU → Shopify через `GET /sku?sku=...`.
