import { redis } from "./client";

/**
 * Channel Affinity
 *
 * Ensures that all messages for a given Discord channel are processed by
 * the same bot worker instance. This is critical when multiple bot
 * workers run in parallel — without affinity, messages to the same channel
 * could be processed out-of-order or concurrently by different workers.
 *
 * Protocol:
 *   - Each worker has a unique WORKER_ID (env var or UUID on startup).
 *   - Before processing a channel's message, the worker checks if it
 *     "owns" the channel.
 *   - Ownership is established via Redis SETNX with a short TTL.
 *   - Workers heartbeat their owned channels every HEARTBEAT_INTERVAL_MS.
 *   - If a worker dies, its channels' ownership keys expire and the next
 *     worker to see a message from that channel claims ownership.
 *
 * Key schema:  channel:owner:{channelId}   → workerId
 * TTL:         OWNERSHIP_TTL_SECONDS (relinquished if no heartbeat)
 */

const CHANNEL_OWNER_PREFIX = "channel:owner:";
export const OWNERSHIP_TTL_SECONDS = 90;      // 90s — must heartbeat within this
export const HEARTBEAT_INTERVAL_MS  = 30_000; // 30s heartbeat

function ownerKey(channelId: string): string {
  return `${CHANNEL_OWNER_PREFIX}${channelId}`;
}

/**
 * Attempt to claim ownership of a channel.
 *
 * @returns true  — this worker now owns the channel.
 *          false — another worker already owns it.
 */
export async function claimChannel(
  channelId: string,
  workerId: string
): Promise<boolean> {
  const result = await redis.set(
    ownerKey(channelId),
    workerId,
    "EX",
    OWNERSHIP_TTL_SECONDS,
    "NX"
  );
  return result === "OK";
}

/**
 * Get the worker ID that currently owns a channel.
 * Returns null if no worker owns it (ownership expired or never set).
 */
export async function getChannelOwner(channelId: string): Promise<string | null> {
  return redis.get(ownerKey(channelId));
}

/**
 * Check whether this worker owns a channel.
 * If not owned by anyone, claims it automatically.
 *
 * @returns true  — this worker should process this channel's message.
 *          false — another worker owns it; skip and let them process.
 */
export async function ownsChannel(
  channelId: string,
  workerId: string
): Promise<boolean> {
  const owner = await getChannelOwner(channelId);

  if (owner === null) {
    // No owner — claim it
    return claimChannel(channelId, workerId);
  }

  return owner === workerId;
}

/**
 * Heartbeat: refresh TTL on all channels owned by this worker.
 * Must be called at least every HEARTBEAT_INTERVAL_MS.
 *
 * @param channelIds Set of channelIds this worker currently processes.
 */
export async function heartbeatChannels(
  channelIds: ReadonlySet<string>,
  workerId: string
): Promise<void> {
  if (channelIds.size === 0) return;

  const pipeline = redis.pipeline();
  for (const channelId of channelIds) {
    // Only extend if we still own it (getset NX alternative — use a Lua script)
    pipeline.eval(
      // Lua: extend TTL only if value matches our workerId
      `if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("expire", KEYS[1], ARGV[2])
       else
         return 0
       end`,
      1,
      ownerKey(channelId),
      workerId,
      String(OWNERSHIP_TTL_SECONDS)
    );
  }
  await pipeline.exec();
}

/**
 * Explicitly release ownership of a channel (e.g. on graceful shutdown).
 */
export async function releaseChannel(
  channelId: string,
  workerId: string
): Promise<void> {
  // Only delete if we own it
  await redis.eval(
    `if redis.call("get", KEYS[1]) == ARGV[1] then
       return redis.call("del", KEYS[1])
     else
       return 0
     end`,
    1,
    ownerKey(channelId),
    workerId
  );
}

/**
 * Release all channels owned by this worker (graceful shutdown).
 */
export async function releaseAllChannels(workerId: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${CHANNEL_OWNER_PREFIX}*`,
      "COUNT",
      100
    );
    for (const key of keys) {
      await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        key,
        workerId
      );
    }
    cursor = nextCursor;
  } while (cursor !== "0");
}
