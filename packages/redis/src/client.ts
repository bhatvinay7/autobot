import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL environment variable is not set");

  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });

  client.on("connect", () => {
    console.log("[redis] connected");
  });

  return client;
}

export const redis: Redis = new Proxy({} as Redis, {
  get(target, prop) {
    if (!globalForRedis.redis) {
      globalForRedis.redis = createRedisClient();
    }
    return Reflect.get(globalForRedis.redis, prop);
  }
});
