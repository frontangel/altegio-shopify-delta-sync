import Redis from 'ioredis';
import { CONFIG } from '../utils/config.js';

let client;
let isReady = false;
let degradedReported = false;

function logRedisDegraded(reason) {
  if (degradedReported) return;
  degradedReported = true;
  console.warn(`🚨 Redis degraded; using disk-backed queue. Reason: ${reason}`);
}

export function getRedisClient() {
  if (client) return client;

  if (!CONFIG.queue.redisUrl) {
    console.warn('Redis URL not provided; falling back to in-memory queue.');
    return null;
  }

  client = new Redis(CONFIG.queue.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  client.on('ready', () => {
    isReady = true;
    degradedReported = false;
    console.log('✅ Redis connection ready');
  });

  client.on('error', (err) => {
    if (!isReady) {
      console.warn(`⚠️ Redis connection not ready: ${err.message}`);
      logRedisDegraded(err.message);
    } else {
      console.warn(`⚠️ Redis error: ${err.message}`);
    }
  });

  client.connect().catch((err) => {
    console.warn(`⚠️ Redis initial connection failed: ${err.message}`);
  });

  return client;
}

export function redisQueueAvailable() {
  return Boolean(client) && isReady;
}

export function markRedisFallback(reason) {
  logRedisDegraded(reason);
}

export function __setRedisTestClient(fakeClient, ready = false) {
  client = fakeClient;
  isReady = ready;
  degradedReported = false;
}
