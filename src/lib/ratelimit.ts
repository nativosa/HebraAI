import { ensureRedisConnected } from "./redis";

export async function rateLimitOrThrow(params: {
  key: string;        // e.g. "translate:1.2.3.4"
  limit: number;      // e.g. 10
  windowSec: number;  // e.g. 60
}) {
  const { key, limit, windowSec } = params;

  const redis = await ensureRedisConnected();

  // Fixed window key (changes every windowSec)
  const windowId = Math.floor(Date.now() / (windowSec * 1000));
  const redisKey = `rl:${key}:${windowId}`;

  // INCR + EXPIRE (only set expiry when key is first created)
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSec);
  }

  const remaining = Math.max(0, limit - count);

  return {
    allowed: count <= limit,
    count,
    remaining,
    resetInSeconds: windowSec, 
  };
}
