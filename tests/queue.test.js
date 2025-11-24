import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALTEGIO_COMPANY_ID = '1';
process.env.ALTEGIO_STORAGE_ID = '10';
process.env.ALTEGIO_TOKEN = 'token';
process.env.ALTEGIO_USER_TOKEN = 'user-token';
process.env.SF_API_VERSION = '2025-01';
process.env.SF_DOMAIN = 'example.myshopify.com';
process.env.SF_ADMIN_ACCESS_TOKEN = 'shpca_token';
process.env.SF_CONST_LOCATION_ID = 'gid://shopify/Location/1';

import { addIdsToQueue, __resetQueueForTests } from '../services/queue2.service.js';
import { __setRedisTestClient } from '../store/redis.client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUEUE_FILE = path.join(__dirname, '..', 'store', 'pending-queue.json');

function cleanup() {
  __resetQueueForTests();
  __setRedisTestClient(null, false);
  if (fs.existsSync(QUEUE_FILE)) {
    fs.unlinkSync(QUEUE_FILE);
  }
}

test.afterEach(cleanup);

test('enqueues via Redis when available', async () => {
  const callLog = { multi: 0, sadd: 0, rpush: 0 };
  const fakeRedis = {
    sismember: async () => false,
    multi() {
      callLog.multi += 1;
      return {
        sadd() {
          callLog.sadd += 1;
          return this;
        },
        rpush() {
          callLog.rpush += 1;
          return this;
        },
        exec: async () => [],
      };
    },
  };

  __setRedisTestClient(fakeRedis, true);
  await addIdsToQueue([11, 12]);

  assert.equal(callLog.multi, 2);
  assert.equal(callLog.sadd, 2);
  assert.equal(callLog.rpush, 2);
  assert.equal(fs.existsSync(QUEUE_FILE), false);
});

test('falls back to disk when Redis is unavailable and logs degradation', async () => {
  const warnMock = mock.method(console, 'warn');
  __setRedisTestClient(null, false);

  await addIdsToQueue([21, 22]);

  const contents = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
  assert.deepEqual(contents.sort(), [21, 22]);
  assert.ok(warnMock.callCount() >= 1);
  const message = warnMock.calls[0].arguments[0];
  assert.match(message, /Redis queue unavailable/);
  warnMock.restore();
});
