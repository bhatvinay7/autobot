import type { UserSession } from "@repo/types";
import { redis } from "./client";

/**
 * Redis LRU Session Store
 *
 * Stores conversation context per (userId, channelId) pair.
 * Acts as an LRU cache: TTL is refreshed on every access/update,
 * so active sessions stay alive. Idle sessions expire automatically.
 *
 * Key schema:   session:{userId}:{channelId}
 * Value:        JSON-serialized UserSession
 * TTL:          SESSION_TTL_SECONDS (30 minutes of inactivity)
 * Max context:  MAX_CONTEXT_MESSAGES recent messages kept in window
 *
 * Redis maxmemory-policy should be set to `allkeys-lru` on the Redis
 * instance so that when memory is full, the least recently used sessions
 * are evicted first. TTL alone handles normal expiry.
 */

export const SESSION_TTL_SECONDS = 30 * 60;       // 30 minutes of inactivity
export const MAX_CONTEXT_MESSAGES = 10;            // context window size
const SESSION_PREFIX = "session:";

function sessionKey(userId: string, channelId: string): string {
  return `${SESSION_PREFIX}${userId}:${channelId}`;
}

/**
 * Load a session from Redis.
 * Refreshes TTL on read (LRU touch).
 * Returns null if session doesn't exist or has expired.
 */
export async function getSession(
  userId: string,
  channelId: string
): Promise<UserSession | null> {
  const key = sessionKey(userId, channelId);
  const raw = await redis.getex(key, "EX", SESSION_TTL_SECONDS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserSession;
  } catch {
    return null;
  }
}

/**
 * Save / update a session in Redis.
 * Always refreshes TTL (LRU touch on write).
 */
export async function saveSession(session: UserSession): Promise<void> {
  const key = sessionKey(session.userId, session.channelId);
  await redis.set(key, JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
}

/**
 * Append a new message to the session context window and update the
 * rolling summary. Trims the context window to MAX_CONTEXT_MESSAGES.
 *
 * Returns the updated session (not yet saved — caller must call saveSession).
 */
export function appendToSession(
  session: UserSession,
  messageContent: string,
  newSummary: string | null
): UserSession {
  const updatedContext = [
    ...session.contextMessages,
    messageContent,
  ].slice(-MAX_CONTEXT_MESSAGES);

  return {
    ...session,
    contextMessages: updatedContext,
    recentSummary: newSummary ?? session.recentSummary,
    messageCount: session.messageCount + 1,
    lastActivity: new Date().toISOString(),
  };
}

/**
 * Create a new empty session for a user.
 */
export function createSession(
  userId: string,
  username: string,
  channelId: string,
  guildId: string | null
): UserSession {
  return {
    userId,
    username,
    channelId,
    guildId,
    recentSummary: null,
    contextMessages: [],
    messageCount: 0,
    lastActivity: new Date().toISOString(),
  };
}

/**
 * Delete a session (e.g. on /reset command).
 */
export async function clearSession(
  userId: string,
  channelId: string
): Promise<void> {
  await redis.del(sessionKey(userId, channelId));
}

/**
 * Get the number of active sessions (for health/monitoring).
 * Uses a Redis SCAN — don't call in hot paths.
 */
export async function countActiveSessions(): Promise<number> {
  let count = 0;
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${SESSION_PREFIX}*`,
      "COUNT",
      100
    );
    count += keys.length;
    cursor = nextCursor;
  } while (cursor !== "0");
  return count;
}
