import { createClient } from "redis";

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: ReturnType<typeof createClient> | undefined;
}

export function getRedisClient() {
  if (!process.env.REDIS_URL) {
    throw new Error("Missing REDIS_URL");
  }

  // Reuse client across hot reloads / invocations where possible
  if (!global.__redisClient) {
    global.__redisClient = createClient({
      url: process.env.REDIS_URL,
    });

    global.__redisClient.on("error", (err) => {
      console.error("Redis Client Error:", err);
    });
  }

  return global.__redisClient;
}

export async function ensureRedisConnected() {
  const client = getRedisClient();
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}
