import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

let redis;
let isReady = false;

if (!REDIS_URL) {
  console.error("❌ REDIS_URL is not set");
  process.exit(1);
}

redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,   // не крешить процес
  enableOfflineQueue: false,   // не накопичує запити
  connectTimeout: 10000,

  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    console.log(`🔁 Redis reconnect attempt #${times}`);
    return delay;
  },
});

// Логи для діагностики
redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("ready", () => {
  console.log("🚀 Redis ready");
  isReady = true;
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

redis.on("close", () => {
  console.warn("⚠️ Redis connection closed");
  isReady = false;
});

redis.on("reconnecting", () => {
  console.warn("🔄 Redis reconnecting...");
});

export function isRedisReady() {
  return isReady;
}

export default redis;
