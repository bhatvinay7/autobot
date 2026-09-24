import { NextRequest, NextResponse } from "next/server";
import { verifyDiscordSignature } from "@/lib/verify";
import {
  isDuplicate,
  storeInteractionToken,
  streamPublish,
} from "@repo/redis";
import type {
  DiscordInteraction,
  InteractionQueueEvent,
} from "@repo/types";

/**
 * Discord Interactions Endpoint
 *
 * This route must:
 * 1. Verify Ed25519 signature on EVERY request (Discord won't accept it otherwise)
 * 2. Respond to PING (type 1) with PONG immediately
 * 3. For slash commands (type 2), respond within ~3 seconds with a deferred ack
 *    and push the real work to the Redis interactions stream
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Read raw body (needed for signature verification) ──────────────────
  const rawBody = await req.text();

  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";

  // ── 2. Verify Ed25519 signature ───────────────────────────────────────────
  if (!verifyDiscordSignature(rawBody, signature, timestamp)) {
    return new NextResponse("Invalid request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return new NextResponse("Invalid JSON body", { status: 400 });
  }

  // ── 3. Handle PING (type 1) ───────────────────────────────────────────────
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 }); // PONG
  }

  // ── 4. Handle Slash Commands (type 2) ─────────────────────────────────────
  if (interaction.type === 2) {
    const { id: interactionId, token, data, guild_id, channel_id, member, user } = interaction;

    // 4a. Deduplication — ignore replayed interactions
    const duplicate = await isDuplicate(interactionId);
    if (duplicate) {
      console.warn(`[ingestion] Duplicate interaction ignored: ${interactionId}`);
      // Still ACK Discord to prevent retries
      return NextResponse.json({
        type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
      });
    }

    // 4b. Store the interaction token with 15-min TTL for follow-up
    await storeInteractionToken(interactionId, token);

    // 4c. Build queue event
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

    // 4d. Push to Redis stream (channel-specific)
    const targetChannel = channel_id ?? "global";
    await streamPublish("interactions", event, targetChannel);

    // 4e. Trigger Lambda Worker if not already active
    try {
      const { redis } = await import("@repo/redis");
      const lock = await redis.set(`worker:active:${targetChannel}`, "1", "EX", 20, "NX");
      if (lock === "OK") {
        // Not active, trigger the worker async
        const workerUrl = `${process.env.APP_URL || "http://localhost:3002"}/api/worker?channelId=${targetChannel}`;
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 100);
        fetch(workerUrl, { method: "POST", signal: controller.signal }).catch(() => {
          // Expect AbortError to happen immediately
        });
      }
    } catch (err) {
      console.error("[ingestion] Failed to trigger worker:", err);
    }

    // 4f. Return deferred ACK within the 3-second window
    // Type 5 = DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    // The bot worker will follow up via the REST API using the token
    return NextResponse.json({ type: 5 });
  }

  // ── 5. Unsupported interaction types ──────────────────────────────────────
  return NextResponse.json({ type: 1 });
}
