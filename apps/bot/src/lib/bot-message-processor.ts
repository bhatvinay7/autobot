/**
 * Bot Message Processor
 *
 * Handles bot-originated messages (not slash command replies).
 *
 * Pipeline (per message, with idempotency):
 *   1. AI: classify intent + enrich/format the message content → immediate
 *   2. Discord channel send                                    → immediate
 *   3. Queue DB write                                          → batched
 *
 * Key difference from INTERACTION processor:
 *   - No interaction token (uses bot token to post to a channel directly)
 *   - No Slack mirror (bot messages don't fan out to Slack by default)
 *   - AI rule: classify intent (not summarize a command) + optionally rewrite
 *     the content before posting
 *
 * Idempotency state machine for BOT_MESSAGE:
 *   claimed → ai_done → discord_done → db_queued → done
 *   (slack_done is skipped — not applicable)
 */

import type { BotMessageQueueEvent, PendingInteractionWrite, PendingActionWrite } from "@repo/types";
import { advanceState, getProcessingState, isStepComplete } from "@repo/redis";
import { withRetry } from "./retry";
import { sendDiscordChannelMessage } from "./discord";
import type { BatchDbWriter } from "./batch-writer";

const MAX_RETRIES = 5;

export interface BotMessageProcessResult {
  messageId: string;
  discordSent: boolean;
  aiRan: boolean;
  skipped: boolean;
  error?: string;
}

export async function processBotMessageEvent(
  event: BotMessageQueueEvent,
  writer: BatchDbWriter
): Promise<BotMessageProcessResult> {
  const { messageId, channelId, guildId, content, triggeredBy, aiEnrich } = event;

  // ── Load current state (crash recovery) ──────────────────────────────────
  const currentState = await getProcessingState(messageId);

  if (currentState === "done") {
    return { messageId, discordSent: true, aiRan: aiEnrich, skipped: true };
  }

  const result: BotMessageProcessResult = {
    messageId,
    discordSent: false,
    aiRan: false,
    skipped: false,
  };

  // ── Step 1: AI enrichment (BOT_MESSAGE rule) ──────────────────────────────
  let finalContent = content;
  let aiLabel: string | null = null;

  const aiDone = isStepComplete(currentState, "ai_done");
  if (!aiDone && aiEnrich) {
    const aiResult = await runBotMessageAi(content, triggeredBy);
    finalContent = aiResult.enrichedContent ?? content;
    aiLabel = aiResult.intentLabel;
    await advanceState(messageId, "ai_done");
  }
  result.aiRan = aiEnrich;

  // ── Step 2: Discord channel send ──────────────────────────────────────────
  const discordDone = isStepComplete(currentState, "discord_done");
  if (!discordDone) {
    await withRetry(
      () => sendDiscordChannelMessage(channelId, finalContent),
      MAX_RETRIES
    );
    await advanceState(messageId, "discord_done");
  }
  result.discordSent = true;

  // ── Step 3: Queue DB write (batched) ──────────────────────────────────────
  const dbDone = isStepComplete(currentState, "db_queued");
  if (!dbDone) {
    // Re-use PendingInteractionWrite to log bot messages too.
    // commandName = "BOT_MESSAGE", commandOptions = [] to keep schema unified.
    const interactionRow: PendingInteractionWrite = {
      interactionId: messageId,
      guildId,
      channelId,
      userId: triggeredBy ?? "system",
      username: "bot",
      commandName: "BOT_MESSAGE",
      commandOptions: [],
      status: "PROCESSED",
      receivedAt: new Date(event.receivedAt),
      processedAt: new Date(),
      aiSummary: aiLabel,
      aiTags: aiLabel ? [aiLabel] : [],
    };
    writer.queueInteraction(interactionRow);

    const discordAction: PendingActionWrite = {
      interactionId: messageId,
      type: "BOT_REPLY",
      status: "SUCCESS",
      payload: { channelId, content: finalContent },
      retryCount: 0,
      error: null,
    };
    writer.queueAction(discordAction);

    if (aiLabel) {
      const aiAction: PendingActionWrite = {
        interactionId: messageId,
        type: "AI_TAG",
        status: "SUCCESS",
        payload: { intentLabel: aiLabel, enrichedContent: finalContent },
        retryCount: 0,
        error: null,
      };
      writer.queueAction(aiAction);
    }

    await advanceState(messageId, "db_queued");
  }

  return result;
}

// ─── AI Step (Bot Message) ────────────────────────────────────────────────────

interface BotMessageAiResult {
  /** Optional rewrite of the message content for better formatting */
  enrichedContent: string | null;
  /** Short intent classification label e.g. "alert", "reminder", "info" */
  intentLabel: string | null;
}

/**
 * AI rule for BOT_MESSAGE events:
 * → Classify the intent of the message and optionally enrich formatting.
 *
 * This is a DIFFERENT rule from INTERACTION AI — bot messages are system
 * notifications, not user commands. The AI makes them cleaner and labels
 * their intent for dashboard visibility.
 */
async function runBotMessageAi(
  content: string,
  triggeredBy: string | null
): Promise<BotMessageAiResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { enrichedContent: null, intentLabel: null };

  try {
    const prompt = `A Discord bot is about to send the following message${triggeredBy ? ` (triggered by ${triggeredBy})` : ""}:

"${content}"

Your tasks:
1. Classify the INTENT of this message with a single lowercase label (e.g. alert, reminder, info, warning, success, error, announcement).
2. Optionally improve the formatting (add relevant emoji at the start, clean up language). Keep it short. If it's already good, return the original.

Respond with JSON only (no markdown):
{
  "intentLabel": "<label>",
  "enrichedContent": "<improved message or original>"
}`;

    const res = await fetch(
      `https://api.groq.com/openai/v1/chat/completions`,
      {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          response_format: { type: "json_object" }
        }),
      }
    );

    if (!res.ok) return { enrichedContent: null, intentLabel: null };

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      intentLabel?: string;
      enrichedContent?: string;
    };

    return {
      enrichedContent: parsed.enrichedContent ?? null,
      intentLabel: parsed.intentLabel ?? null,
    };
  } catch {
    return { enrichedContent: null, intentLabel: null };
  }
}
