import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { verifyDiscordSignature } from "./lib/verify";
import { isDuplicate, storeInteractionToken, streamPublish } from "@repo/redis";
import type { DiscordInteraction, InteractionQueueEvent } from "@repo/types";

const app = express();
app.use(cors());

// We need the raw body as text for signature verification
app.use(express.text({ type: "application/json" }));

app.post("/api/interactions", async (req: Request, res: Response) => {
  const rawBody = req.body;
  const signature = req.headers["x-signature-ed25519"] as string || "";
  const timestamp = req.headers["x-signature-timestamp"] as string || "";

  if (!verifyDiscordSignature(rawBody, signature, timestamp)) {
    res.status(401).send("Invalid request signature");
    return;
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    res.status(400).send("Invalid JSON body");
    return;
  }

  if (interaction.type === 1) {
    res.json({ type: 1 });
    return;
  }

  if (interaction.type === 2) {
    const { id: interactionId, token, data, guild_id, channel_id, member, user } = interaction;
    const duplicate = await isDuplicate(interactionId);
    if (duplicate) {
      console.warn(`[ingestion] Duplicate interaction ignored: ${interactionId}`);
      res.json({ type: 5 });
      return;
    }

    await storeInteractionToken(interactionId, token);

    const actor = member?.user ?? user;
    const event: InteractionQueueEvent = {
      kind: "INTERACTION",
      interactionId,
      guildId: guild_id ?? null,
      channelId: channel_id ?? null,
      userId: actor?.id ?? "unknown",
      username: actor?.username ?? "unknown",
      commandName: data?.name ?? "unknown",
      commandOptions: data?.options ?? [],
      token,
      applicationId: interaction.application_id,
      receivedAt: new Date().toISOString(),
    };

    const targetChannel = channel_id ?? "global";
    await streamPublish("interactions", event, targetChannel);

    try {
      const { redis } = await import("@repo/redis");
      const lock = await redis.set(`worker:active:${targetChannel}`, "1", "EX", 20, "NX");
      if (lock === "OK") {
        const workerUrl = `${process.env.APP_URL || "http://localhost:3002"}/api/worker?channelId=${targetChannel}`;
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 100);
        fetch(workerUrl, { method: "POST", signal: controller.signal }).catch(() => {});
      }
    } catch (err) {
      console.error("[ingestion] Failed to trigger worker:", err);
    }

    res.json({ type: 5 });
    return;
  }

  res.json({ type: 1 });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`> Ingestion API Server running on port ${PORT}`);
});
