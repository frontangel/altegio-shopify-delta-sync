import Redis from 'ioredis';
import { CONFIG } from '../utils/config.js';

let client;
let isReady = false;

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
    console.log('✅ Redis connection ready');
  });

  client.on('error', (err) => {
    if (!isReady) {
      console.warn(`⚠️ Redis connection not ready: ${err.message}`);
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
