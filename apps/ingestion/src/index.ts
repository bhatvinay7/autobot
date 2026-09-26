import "dotenv/config";

import express, { Request, Response } from "express";
import cors from "cors";
import { verifyDiscordSignature } from "./lib/verify";
import { isDuplicate, storeInteractionToken, streamPublish } from "@repo/redis";
import type { DiscordInteraction, InteractionQueueEvent } from "@repo/types";

const app = express();
app.use(cors());

// Log all requests
app.use((req, res, next) => {
  console.log(`[ingestion] Incoming ${req.method} request to ${req.url}`);
  next();
});

// We need the raw body as a Buffer for exact signature verification
app.use(express.raw({ type: "application/json" }));

app.post("/api/interactions", async (req: Request, res: Response) => {
  console.log(`[ingestion] Received interaction!`);
  const rawBody = req.body as Buffer;
  const signature = req.headers["x-signature-ed25519"] as string || "";
  const timestamp = req.headers["x-signature-timestamp"] as string || "";

  if (!verifyDiscordSignature(rawBody, signature, timestamp)) {
    res.status(401).send("Invalid request signature");
    return;
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody.toString("utf8")) as DiscordInteraction;
  } catch {
    res.status(400).send("Invalid JSON body");
    return;
  }

  if (interaction.type === 1) {
    res.json({ type: 1 });
    return;
  }

  if (interaction.type === 2 || interaction.type === 3) {
    const { id: interactionId, token, data, guild_id, channel_id, member, user } = interaction;
    
    // 1. Acknowledge immediately to avoid Discord's 3-second timeout
    // Type 5: deferred channel message (for commands)
    // Type 6: deferred update message (for buttons)
    res.json({ type: interaction.type === 3 ? 6 : 5 });

    // 2. Check for duplicate *after* acknowledging
    const duplicate = await isDuplicate(interactionId);
    
    if (duplicate) {
      console.warn(`[ingestion] Duplicate interaction ignored: ${interactionId}`);
      return; // Already acknowledged, just stop processing
    }

    // Process the event and add to queue in the background
    (async () => {
      try {
        await storeInteractionToken(interactionId, token);

        const actor = member?.user ?? user;
        const event: InteractionQueueEvent = {
          kind: "INTERACTION",
          interactionId,
          guildId: guild_id ?? null,
          channelId: channel_id ?? null,
          userId: actor?.id ?? "unknown",
          username: actor?.username ?? "unknown",
          commandName: data?.name ?? data?.custom_id ?? "unknown",
          commandOptions: data?.options ?? [],
          token,
          applicationId: interaction.application_id,
          receivedAt: new Date().toISOString(),
        };

        const targetChannel = channel_id ?? "global";
        await streamPublish("interactions", event, targetChannel);

        const { redis } = await import("@repo/redis");
        const lock = await redis.set(`worker:active:${targetChannel}`, "1", "EX", 20, "NX");
        if (lock === "OK") {
          const workerUrl = `${process.env.APP_URL || "http://localhost:3002"}/api/worker?channelId=${targetChannel}`;
          fetch(workerUrl, { method: "POST" }).catch(() => {});
        }
      } catch (err) {
        console.error("[ingestion] Background processing error:", err);
      }
    })();
    return;
  }

  res.json({ type: 1 });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`> Ingestion API Server running on port ${PORT}`);
});
