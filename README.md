# 🛒 Altegio → Shopify Sync Service

Цей проєкт приймає вебхуки з [Altegio](https://altegio.com/) та оновлює залишки товарів у [Shopify](https://shopify.com) за відповідним SKU.

---

## ⚙️ Опис

Це мінімалістичний Node.js сервіс, який:

- ✅ Приймає webhook'и типу `goods_operations_sale` з Altegio
- ✅ Визначає відповідний товар у Shopify за артикулом (SKU)
- ✅ Оновлює кількість товару в Shopify через GraphQL API
- ✅ Використовує локальне кешування даних без бази даних
- ✅ Має **примітивну чергу** для уникнення Shopify API rate-limit
- ✅ Працює з фіксованим `LocationId`, переданим через `.env`

---

## 📦 Стек

- Node.js + Express
- `graphql-request` для запитів до Shopify
- `dotenv` для конфігурації
- Простий `queue.service.js` на `setInterval` без сторонніх бібліотек
- Кешування в памʼяті (через `CacheManager`)

---

## 📁 Структура проєкту
```
.
├── .env                  # Змінні середовища
├── index.js              # Точка входу
├── services/
│   ├── shopify.service.js      # Shopify API запити
│   └── queue.service.js        # Черга для контролю частоти запитів
├── store/
│   ├── useStore.js             # Алгоритм мапінгу SKU
│   └── cache.manager.js        # Примітивний кеш у памʼяті
```

---

## 🧪 Запуск локально

### 1. Встановлення

```bash
npm install
```

### 2. Налаштування `.env`

```env
SF_API_VERSION=2025-04
SF_DOMAIN=your-store.myshopify.com
SF_ADMIN_ACCESS_TOKEN=shpat_xxxxx
SF_CONST_LOCATION_ID=gid://shopify/Location/123456789
PORT=3000
```

### 3. Запуск

```bash
npm start
```

---

## 🔄 Webhook

Очікується POST-запит від Altegio на:

```
POST /webhook
```

Приклад тіла запиту:
```json
{
  "resource": "goods_operations_sale",
  "company_id": 12345,
  "data": {
    "good": { "id": 678 },
    "amount": -2
  }
}
```

---

## 🔁 Черга

Завдання (наприклад, оновити залишок) не виконуються одразу, а ставляться в чергу (`queue.service.js`) і виконуються **по одному кожну секунду** для уникнення Shopify Throttle (`Throttled`).

---

## 📥 Ендпоінти

- `GET /sku?sku=123456` – отримає inventoryItemId за SKU
- `GET /db` – віддає поточний кеш SKU ↔ inventoryID
- `POST /webhook` – головна точка інтеграції з Altegio

---

## 🛑 Обмеження

- Немає бази даних (тільки кеш у памʼяті)
- Примітивна черга без retry-логіки
- Працює тільки з одним `LocationId`

---

## 🔐 Безпека

### 🔐 Basic Auth для доступу до внутрішніх endpoint'ів

Маршрути `/db` і `/sku` захищені базовою авторизацією (Basic Auth).

У `.env` необхідно вказати:

```env
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=mystrongpassword
```

Тестовий запит:

```bash
curl -u admin:mystrongpassword https://your-app.up.railway.app/db
```

---

## 📌 Плани на майбутнє

- Додати збереження кешу у Redis або MongoDB
- Розширити підтримку інших типів webhook'ів
- Додати retry для помилок типу `Throttled` чи `5xx`
- Підтримка кількох компаній / локацій (multi-tenant)

---



## 👤 Автор
Розроблено **Frontangel**.  
Запитання чи пропозиції? Напиши в [Telegram](https://t.me/frontangel) або [GitHub Issues](https://github.com/frontangel/altegio-shopify-delta-sync/issues).
