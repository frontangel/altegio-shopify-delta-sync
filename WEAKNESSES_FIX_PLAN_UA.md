# План виправлення слабких місць

## 1. Виправити валідацію webhook-підпису (критично)
- Перейти на перевірку HMAC по `raw body`, а не по `req.body`.
- Додати валідацію формату підпису та явний reject.
- Додати unit-тести: `valid`, `invalid`, `missing signature`.
- DoD: перевірка підпису стабільна і відтворювана для однакового payload.

## 2. Зробити атомарне release lock (критично)
- Замінити `GET + DEL` на Lua compare-and-delete.
- Забезпечити, що lock може зняти лише власник.
- Додати конкурентний тест.
- DoD: чужий worker не може видалити lock.

## 3. Додати heartbeat для lock (високий)
- Під час довгих sync-операцій періодично робити `extendLock`.
- Завжди зупиняти heartbeat у `finally`.
- DoD: lock не протухає під час довгих зовнішніх API-викликів.

## 4. Уніфікувати manual sync і webhook задачі (високий)
- Привести формат задачі черги до єдиного контракту.
- Додати явну обробку manual-задач у worker.
- DoD: `/sync/:sku?q=...` проходить стабільно end-to-end.

## 5. Оптимізувати логи в Redis (високий)
- Прибрати масовий `SCAN` для читання логів.
- Перейти на Redis Stream або Sorted Set + пагінація.
- DoD: читання останніх логів стабільне при великому обсязі.

## 6. Полегшити warmup SKU (середній)
- Зробити інкрементальний/фоновий warmup.
- Додати timestamp останньої успішної синхронізації кешу.
- DoD: швидкий старт сервісу без довгого блокування readiness.

## 7. Розділити API і worker процеси (середній)
- Окремі entrypoints та npm scripts для API/worker.
- Окремі health/readiness перевірки.
- DoD: збій API не зупиняє worker і навпаки.

## 8. Додати критичні тести (середній)
- Unit: signature, idempotency, lock, retry/dead-letter.
- Integration: webhook -> queue -> worker -> Shopify mock.
- DoD: CI перевіряє ключові сценарії обробки.

## 9. Додати метрики й алерти (середній)
- Метрики: queue depth, retries, dead-letter rate, sync latency.
- Алерти на деградацію.
- DoD: операційно видно якість синхронізації і причини збоїв.

---

## Швидкі відповіді по поточному стану

### Який HTTP код ми відповідаємо
- `POST /webhook`:
  - `200`, якщо webhook пропущено (`ctx.done`) або успішно поставлено в чергу.
  - `400`, якщо помилка в pipeline обробки (`ctx.error`).
  - `403`, якщо увімкнена webhook security і підпис відсутній/невалідний.
- Адмін-роути:
  - `401`, якщо немає Basic Auth.
  - `403`, якщо Basic Auth невірний.
- Додатково:
  - `500` при збої `waitUntilReady` або внутрішніх помилках окремих роутів.

### Чи є блокування
- Так, є distributed lock по SKU в Redis (`lock:sku:*`), щоб два worker-и не оновлювали один SKU паралельно.

### Чи є ретраї
- Так, є:
  - retry задач черги до `MAX_RETRIES=3`, далі `dead_letter`;
  - recovery “stale” задач з `processing`;
  - retry/backoff для Altegio API;
  - retry/backoff для Shopify (throttle/network/5xx).
