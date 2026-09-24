import { NextResponse } from "next/server";
import {
  ensureConsumerGroup,
  streamReadMultiple,
  streamAck,
  claimEvent,
  redis,
} from "@repo/redis";
import type { QueueEvent, InteractionQueueEvent, BotMessageQueueEvent } from "@repo/types";
import { BatchDbWriter } from "../../../lib/batch-writer";
import { processInteractionEvent } from "../../../lib/interaction-processor";
// bot message processor is currently missing, let's create a stub or just handle interaction for now
// import { processBotMessageEvent } from "@/lib/bot-message-processor";

export const maxDuration = 60; // Vercel hobby max 10s/60s, pro 300s. Let's maximize within hobby limits.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const channelId = url.searchParams.get("channelId");

  if (!channelId) {
    return NextResponse.json({ error: "Missing channelId" }, { status: 400 });
  }

  console.log(`[worker] Starting lambda for channel: ${channelId}`);

  await Promise.all([
    ensureConsumerGroup("interactions", channelId),
    ensureConsumerGroup("bot-messages", channelId),
  ]);

  const writer = new BatchDbWriter();
  let idleTime = 0;
  const IDLE_TIMEOUT_MS = 20000;
  const BLOCK_MS = 2000;
  const start = Date.now();
  const MAX_EXECUTION_TIME_MS = 50000; // Leave 10s buffer before 60s maxDuration limit

  while (idleTime < IDLE_TIMEOUT_MS && (Date.now() - start) < MAX_EXECUTION_TIME_MS) {
    try {
      const results = await streamReadMultiple(
        [
          { name: "interactions", suffix: channelId },
          { name: "bot-messages", suffix: channelId }
        ],
        `worker-${channelId}`,
        10,
        BLOCK_MS
      );

      if (!results || results.length === 0) {
        idleTime += BLOCK_MS;
        continue;
      }

      // Reset idle time and extend lock since we are active
      idleTime = 0;
      await redis.expire(`worker:active:${channelId}`, 20);

      for (const { stream, suffix, entries } of results) {
        for (const entry of entries) {
          const event = entry.event as QueueEvent;
          const isInteraction = event.kind === "INTERACTION";
          const eventId = isInteraction 
            ? (event as InteractionQueueEvent).interactionId 
            : (event as BotMessageQueueEvent).messageId;

          const claimed = await claimEvent(eventId);
          if (claimed) {
            if (isInteraction) {
              const res = await processInteractionEvent(event as InteractionQueueEvent, writer);
              if (res.discordSent || res.slackSent) {
                // Feature: Publish to dashboard live logs SSE channel
                const logEntry = JSON.stringify({
                  id: eventId,
                  channelId,
                  type: "INTERACTION",
                  payload: event,
                  result: res,
                  timestamp: new Date().toISOString()
                });
                
                // Add to LRU Capped list (max 100 items)
                await redis.lpush("dashboard:logs:latest", logEntry);
                await redis.ltrim("dashboard:logs:latest", 0, 99);
                // Publish to live subscribers
                await redis.publish("dashboard:logs:pubsub", logEntry);
              }
            } else if (event.kind === "BOT_MESSAGE") {
              // await processBotMessageEvent(event as BotMessageQueueEvent, writer);
            }
          }
          await streamAck(stream, entry.streamId, suffix);
        }
      }
    } catch (err) {
      console.error(`[worker] Loop error for ${channelId}:`, err);
      // Don't crash immediately, wait a bit
      await new Promise(r => setTimeout(r, 1000));
      idleTime += 1000;
    }
  }

  // Cleanup: flush DB and remove lock
  console.log(`[worker] Exiting lambda for channel: ${channelId} (idle: ${idleTime}ms, runtime: ${Date.now() - start}ms, pendingCount: ${writer.pendingCount})`);
  if (writer.pendingCount > 0) {
    try {
      await writer.flush();
    } catch (e) {
      console.error(`[worker] Failed to flush DB on exit for ${channelId}:`, e);
    }
  }
  await redis.del(`worker:active:${channelId}`);

  return NextResponse.json({ status: "OK", channelId });
}
