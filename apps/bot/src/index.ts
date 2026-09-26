import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import {
  ensureConsumerGroup,
  streamReadMultiple,
  streamAck,
  claimEvent,
  redis,
} from "@repo/redis";
import type { QueueEvent, InteractionQueueEvent, BotMessageQueueEvent } from "@repo/types";
import { BatchDbWriter } from "./lib/batch-writer";
import { 
  processBotInteraction, 
  processSlackMirror, 
  processDbWrite 
} from "./lib/interaction-processor";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/worker", async (req: Request, res: Response) => {
  const channelId = req.query.channelId as string;

  if (!channelId) {
    res.status(400).json({ error: "Missing channelId" });
    return;
  }

  console.log(`[worker] Starting worker task for channel: ${channelId}`);

  res.json({ status: "Started", channelId });

  (async () => {
    try {
      // Create independent consumer groups for the fanout
      await Promise.all([
        ensureConsumerGroup("interactions", channelId, "cg-bot-processor"),
        ensureConsumerGroup("interactions", channelId, "cg-slack-notifier"),
        ensureConsumerGroup("interactions", channelId, "cg-db-writer"),
        ensureConsumerGroup("bot-messages", channelId, "cg-bot-processor"),
      ]);

      const MAX_EXECUTION_TIME_MS = 50000; // Leave 10s buffer
      const IDLE_TIMEOUT_MS = 20000;
      const BLOCK_MS = 2000;
      const start = Date.now();
      
      const writer = new BatchDbWriter();
      let pendingCountRef = { count: 0 }; // tracking across loops

      // 1. Bot Processor Loop
      const runBotLoop = async () => {
        let idleTime = 0;
        while (idleTime < IDLE_TIMEOUT_MS && (Date.now() - start) < MAX_EXECUTION_TIME_MS) {
          try {
            const results = await streamReadMultiple(
              [
                { name: "interactions", suffix: channelId },
                { name: "bot-messages", suffix: channelId }
              ],
              `worker-${channelId}`,
              10, BLOCK_MS, "cg-bot-processor"
            );
            if (!results || results.length === 0) { idleTime += BLOCK_MS; continue; }
            idleTime = 0;
            await redis.expire(`worker:active:${channelId}`, 20);

            for (const { stream, suffix, entries } of results) {
              for (const entry of entries) {
                const event = entry.event as QueueEvent;
                const isInteraction = event.kind === "INTERACTION";
                const eventId = isInteraction ? (event as InteractionQueueEvent).interactionId : (event as BotMessageQueueEvent).messageId;

                const claimed = await claimEvent(`bot:${eventId}`);
                if (claimed) {
                  if (isInteraction) {
                    const res = await processBotInteraction(event as InteractionQueueEvent);
                    if (res.discordSent) {
                      const logEntry = JSON.stringify({
                        id: eventId, channelId, type: "INTERACTION", payload: event, result: res, timestamp: new Date().toISOString()
                      });
                      await redis.lpush("dashboard:logs:latest", logEntry);
                      await redis.ltrim("dashboard:logs:latest", 0, 99);
                      await redis.publish("dashboard:logs:pubsub", logEntry);
                    }
                  }
                }
                await streamAck(stream, entry.streamId, suffix, "cg-bot-processor");
              }
            }
          } catch (err) {
            console.error(`[cg-bot-processor] Loop error for ${channelId}:`, err);
            await new Promise(r => setTimeout(r, 1000));
            idleTime += 1000;
          }
        }
      };

      // 2. Slack Notifier Loop
      const runSlackLoop = async () => {
        let idleTime = 0;
        while (idleTime < IDLE_TIMEOUT_MS && (Date.now() - start) < MAX_EXECUTION_TIME_MS) {
          try {
            const results = await streamReadMultiple(
              [{ name: "interactions", suffix: channelId }],
              `worker-${channelId}`,
              10, BLOCK_MS, "cg-slack-notifier"
            );
            if (!results || results.length === 0) { idleTime += BLOCK_MS; continue; }
            idleTime = 0;
            for (const { stream, suffix, entries } of results) {
              for (const entry of entries) {
                const event = entry.event as InteractionQueueEvent;
                const claimed = await claimEvent(`slack:${event.interactionId}`);
                if (claimed && event.kind === "INTERACTION") {
                  await processSlackMirror(event);
                }
                await streamAck(stream, entry.streamId, suffix, "cg-slack-notifier");
              }
            }
          } catch (err) {
            console.error(`[cg-slack-notifier] Loop error for ${channelId}:`, err);
            await new Promise(r => setTimeout(r, 1000));
            idleTime += 1000;
          }
        }
      };

      // 3. DB Writer Loop
      const runDbLoop = async () => {
        let idleTime = 0;
        while (idleTime < IDLE_TIMEOUT_MS && (Date.now() - start) < MAX_EXECUTION_TIME_MS) {
          try {
            const results = await streamReadMultiple(
              [{ name: "interactions", suffix: channelId }],
              `worker-${channelId}`,
              10, BLOCK_MS, "cg-db-writer"
            );
            if (!results || results.length === 0) { idleTime += BLOCK_MS; continue; }
            idleTime = 0;
            for (const { stream, suffix, entries } of results) {
              for (const entry of entries) {
                const event = entry.event as InteractionQueueEvent;
                const claimed = await claimEvent(`db:${event.interactionId}`);
                if (claimed && event.kind === "INTERACTION") {
                  await processDbWrite(event, writer);
                  pendingCountRef.count = writer.pendingCount;
                }
                await streamAck(stream, entry.streamId, suffix, "cg-db-writer");
              }
            }
          } catch (err) {
            console.error(`[cg-db-writer] Loop error for ${channelId}:`, err);
            await new Promise(r => setTimeout(r, 1000));
            idleTime += 1000;
          }
        }
      };

      // Run all loops concurrently
      await Promise.all([runBotLoop(), runSlackLoop(), runDbLoop()]);

      // Cleanup: flush DB and remove lock
      console.log(`[worker] Exiting worker task for channel: ${channelId} (runtime: ${Date.now() - start}ms, pendingCount: ${writer.pendingCount})`);
      if (writer.pendingCount > 0) {
        try {
          await writer.flush();
        } catch (e) {
          console.error(`[worker] Failed to flush DB on exit for ${channelId}:`, e);
        }
      }
      await redis.del(`worker:active:${channelId}`);
      
    } catch (err) {
      console.error(`[worker] Fatal background task error for ${channelId}:`, err);
    }
  })();
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`> Bot API Server running on port ${PORT}`);
});
