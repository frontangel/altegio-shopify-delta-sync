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
