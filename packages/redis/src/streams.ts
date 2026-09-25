import type { QueueEvent, StreamName } from "@repo/types";
import { redis } from "./client";

// ─── Stream Names ─────────────────────────────────────────────────────────────

export const STREAMS: Record<StreamName, string> = {
  interactions: "stream:interactions",
  "bot-messages": "stream:bot-messages",
  "bot-replies": "stream:bot-replies",
  mirrors: "stream:mirrors",
  dlq: "stream:dlq",
};

export const CONSUMER_GROUP = "workers";

// ─── Publish to a stream ──────────────────────────────────────────────────────

export async function streamPublish<T extends QueueEvent>(
  stream: StreamName,
  event: T,
  suffix?: string
): Promise<string> {
  let key = STREAMS[stream];
  if (suffix) {
    key = `${key}:${suffix}`;
  }
  const id = await redis.xadd(key, "*", "data", JSON.stringify(event));
  if (!id) throw new Error(`Failed to publish to stream: ${key}`);
  return id;
}

// ─── Ensure consumer group exists ────────────────────────────────────────────

export async function ensureConsumerGroup(stream: StreamName, suffix?: string): Promise<void> {
  let key = STREAMS[stream];
  if (suffix) {
    key = `${key}:${suffix}`;
  }
  try {
    await redis.xgroup("CREATE", key, CONSUMER_GROUP, "0", "MKSTREAM");
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) {
      throw err;
    }
  }
}

// ─── Read from a consumer group ───────────────────────────────────────────────

export interface StreamEntry<T extends QueueEvent> {
  streamId: string;
  event: T;
}

export async function streamRead<T extends QueueEvent>(
  stream: StreamName,
  consumerName: string,
  count = 10,
  blockMs = 0,
  suffix?: string
): Promise<StreamEntry<T>[]> {
  let key = STREAMS[stream];
  if (suffix) {
    key = `${key}:${suffix}`;
  }
  const results = await redis.xreadgroup(
    "GROUP",
    CONSUMER_GROUP,
    consumerName,
    "COUNT",
    count,
    "BLOCK",
    blockMs,
    "STREAMS",
    key,
    ">"
  );

  if (!results) return [];

  const entries: StreamEntry<T>[] = [];
  for (const [, messages] of results as [string, [string, string[]][]][]) {
    for (const [id, fields] of messages) {
      const dataIndex = fields.indexOf("data");
      if (dataIndex === -1) continue;
      const raw = fields[dataIndex + 1];
      if (!raw) continue;
      entries.push({ streamId: id, event: JSON.parse(raw) as T });
    }
  }
  return entries;
}

export async function streamReadMultiple(
  streams: { name: StreamName; suffix?: string }[],
  consumerName: string,
  count = 10,
  blockMs = 1000
): Promise<{ stream: StreamName; suffix?: string; entries: StreamEntry<QueueEvent>[] }[]> {
  const streamKeys = streams.map((s) => {
    let key = STREAMS[s.name];
    if (s.suffix) key = `${key}:${s.suffix}`;
    return key;
  });
  const ids = streams.map(() => ">");
  
  const results = await redis.xreadgroup(
    "GROUP",
    CONSUMER_GROUP,
    consumerName,
    "COUNT",
    count,
    "BLOCK",
    blockMs,
    "STREAMS",
    ...streamKeys,
    ...ids
  );

  if (!results) return [];

  const parsed: { stream: StreamName; suffix?: string; entries: StreamEntry<QueueEvent>[] }[] = [];
  for (const [streamKey, messages] of results as [string, [string, string[]][]][]) {
    // Find matching stream by key
    const matchingInput = streams.find(s => {
      let k = STREAMS[s.name];
      if (s.suffix) k = `${k}:${s.suffix}`;
      return k === streamKey;
    });

    if (!matchingInput) continue;

    const entries: StreamEntry<QueueEvent>[] = [];
    for (const [id, fields] of messages) {
      const dataIndex = fields.indexOf("data");
      if (dataIndex === -1) continue;
      const raw = fields[dataIndex + 1];
      if (!raw) continue;
      entries.push({ streamId: id, event: JSON.parse(raw) as QueueEvent });
    }
    parsed.push({ stream: matchingInput.name, suffix: matchingInput.suffix, entries });
  }
  return parsed;
}

// ─── Acknowledge a message ────────────────────────────────────────────────────

export async function streamAck(
  stream: StreamName,
  streamId: string,
  suffix?: string
): Promise<void> {
  let key = STREAMS[stream];
  if (suffix) {
    key = `${key}:${suffix}`;
  }
  await redis.xack(key, CONSUMER_GROUP, streamId);
}

// ─── Move to DLQ ─────────────────────────────────────────────────────────────

export async function moveToDlq<T extends QueueEvent>(
  stream: StreamName,
  streamId: string,
  event: T,
  error: Error | string,
  suffix?: string
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : error;
  await streamPublish("dlq", {
    ...event,
    originalStream: stream,
    error: errorMessage,
    _dlqAt: new Date().toISOString(),
  } as unknown as T);
  await streamAck(stream, streamId, suffix);
}

// ─── Deduplication via TTL key ────────────────────────────────────────────────

const DEDUP_PREFIX = "dedup:interaction:";
const DEDUP_TTL_SECONDS = 86400; // 24 hours

export async function isDuplicate(interactionId: string): Promise<boolean> {
  const key = `${DEDUP_PREFIX}${interactionId}`;
  // SET NX returns "OK" if set, null if already exists
  const result = await redis.set(key, "1", "EX", DEDUP_TTL_SECONDS, "NX");
  return result === null; // null means key already existed → duplicate
}

// ─── Token TTL (Discord reply token, 15 min) ──────────────────────────────────

const TOKEN_PREFIX = "token:interaction:";
const TOKEN_TTL_SECONDS = 840; // 14 minutes

export async function storeInteractionToken(
  interactionId: string,
  token: string
): Promise<void> {
  await redis.set(`${TOKEN_PREFIX}${interactionId}`, token, "EX", TOKEN_TTL_SECONDS);
}

export async function getInteractionToken(
  interactionId: string
): Promise<string | null> {
  return redis.get(`${TOKEN_PREFIX}${interactionId}`);
}

// ─── Stream depth / health ────────────────────────────────────────────────────

export async function getStreamDepth(stream: StreamName): Promise<number> {
  const info = await redis.xlen(STREAMS[stream]);
  return info;
}

export async function getDlqDepth(): Promise<number> {
  return redis.xlen(STREAMS.dlq);
}
