/**
 * Interaction Processor
 *
 * Handles slash command interactions from Discord users.
 *
 * Pipeline (per message, with idempotency + session context):
 *   1. Load user session from Redis LRU (provides AI context)
 *   2. Discord follow-up reply       → immediate
 *   3. Slack mirror notification     → immediate
 *   4. AI: summarize + tag command   → uses session context, updates session
 *   5. Save session back to Redis    → refreshes TTL (LRU touch)
 *   6. Queue DB write                → batched, flushed at end of invocation
 */

import type {
  InteractionQueueEvent,
  PendingInteractionWrite,
  PendingActionWrite,
  UserSession,
} from "@repo/types";
import { 
  advanceState, 
  getProcessingState, 
  isStepComplete,
  getSession,
  createSession,
  appendToSession,
  saveSession
} from "@repo/redis";
import { withRetry } from "./retry";
import { sendDiscordFollowUp, sendDiscordChannelMessage } from "./discord";
import { sendSlackNotification } from "./slack";
import type { BatchDbWriter } from "./batch-writer";
import { fetchSimilarContext } from "./vector";

const MAX_RETRIES = 5;

export interface InteractionProcessResult {
  interactionId: string;
  discordSent: boolean;
  slackSent: boolean;
  aiRan: boolean;
  skipped: boolean;
  error?: string;
}

export async function processBotInteraction(event: InteractionQueueEvent): Promise<InteractionProcessResult> {
  const { interactionId, token, applicationId, commandName, commandOptions, username, guildId, channelId, userId } = event;
  const currentState = await getProcessingState(`bot:${interactionId}`);
  if (currentState === "done") {
    return { interactionId, discordSent: true, slackSent: false, aiRan: true, skipped: true };
  }

  const result: InteractionProcessResult = { interactionId, discordSent: false, slackSent: false, aiRan: false, skipped: false };
  const optionText = commandOptions.length > 0 ? commandOptions.map((o) => `${o.name}: ${o.value}`).join(", ") : "no options";

  const channel = channelId ?? "dm";
  let session = (await getSession(userId, channel)) ?? createSession(userId, username, channel, guildId);

  // Step 1: Discord reply
  if (!isStepComplete(currentState, "discord_done")) {
    const sessionHint = session.messageCount > 0 && session.recentSummary ? `\n> *Context:* ${session.recentSummary}` : "";
    try {
      await withRetry(() => sendDiscordFollowUp(applicationId, token, `✅ **/${commandName}** received — ${optionText}${sessionHint}`), MAX_RETRIES);
      result.discordSent = true;
    } catch (e: unknown) {
      console.warn("[processor] Discord follow-up failed (non-fatal):", e instanceof Error ? e.message : e);
      result.discordSent = false;
    }
    await advanceState(`bot:${interactionId}`, "discord_done");
  } else {
    result.discordSent = true;
  }

  // Step 2: AI enrichment & Second Discord Message
  if (!isStepComplete(currentState, "ai_done")) {
    const aiResult = await runInteractionAi(commandName, optionText, username, session);
    if (aiResult.answer) {
      try {
        await withRetry(() => sendDiscordFollowUp(applicationId, token, `🤖 **AI Response:**\n${aiResult.answer}`), MAX_RETRIES);
      } catch (e: unknown) {
        console.warn("[processor] Second Discord follow-up failed:", e instanceof Error ? e.message : e);
      }
    }
    if (aiResult.imageUrl) {
      try {
        await withRetry(() => sendDiscordFollowUp(applicationId, token, `🖼️ **Related Image:**\n${aiResult.imageUrl}`), MAX_RETRIES);
      } catch (e: unknown) {
        console.warn("[processor] Image Discord follow-up failed:", e instanceof Error ? e.message : e);
      }
    }
    const messageContent = `/${commandName} ${optionText}`;
    session = appendToSession(session, messageContent, aiResult.updatedSessionSummary);
    await saveSession(session);
    
    // Store AI results temporarily for DB writer to pick up (using Redis)
    if (aiResult.summary || aiResult.tags.length > 0) {
      await redis.set(`ai_result:${interactionId}`, JSON.stringify({ summary: aiResult.summary, tags: aiResult.tags }), "EX", 3600);
    }
    await advanceState(`bot:${interactionId}`, "ai_done");
  }
  result.aiRan = true;

  // Mark overall as done
  await advanceState(`bot:${interactionId}`, "done");
  return result;
}

export async function processSlackMirror(event: InteractionQueueEvent): Promise<InteractionProcessResult> {
  const { interactionId, commandName, commandOptions, username, guildId } = event;
  const currentState = await getProcessingState(`slack:${interactionId}`);
  if (currentState === "done") {
    return { interactionId, discordSent: false, slackSent: true, aiRan: false, skipped: true };
  }

  const result: InteractionProcessResult = { interactionId, discordSent: false, slackSent: false, aiRan: false, skipped: false };
  const optionText = commandOptions.length > 0 ? commandOptions.map((o) => `${o.name}: ${o.value}`).join(", ") : "no options";
  const mirrorText = `🤖 **/${commandName}** by \`${username}\` in guild \`${guildId ?? "DM"}\` — ${optionText}`;

  if (!isStepComplete(currentState, "slack_done")) {
    try {
      await withRetry(() => sendSlackNotification(mirrorText), MAX_RETRIES);
      result.slackSent = true;
      
      const mirrorChannelId = process.env.DISCORD_MIRROR_CHANNEL_ID;
      if (mirrorChannelId) {
        await withRetry(() => sendDiscordChannelMessage(mirrorChannelId, mirrorText), MAX_RETRIES).catch((e: unknown) => console.warn("[processor] Mirror channel send failed:", e));
      }
    } catch (e: unknown) {
      console.warn("[processor] Slack mirror failed (non-fatal):", e instanceof Error ? e.message : e);
      result.slackSent = false;
    }
    await advanceState(`slack:${interactionId}`, "slack_done");
  } else {
    result.slackSent = true;
  }
  
  await advanceState(`slack:${interactionId}`, "done");
  return result;
}

export async function processDbWrite(event: InteractionQueueEvent, writer: BatchDbWriter): Promise<InteractionProcessResult> {
  const { interactionId, commandName, commandOptions, username, guildId, channelId, userId, applicationId } = event;
  const currentState = await getProcessingState(`db:${interactionId}`);
  if (currentState === "done") {
    return { interactionId, discordSent: false, slackSent: false, aiRan: false, skipped: true };
  }
  
  const result: InteractionProcessResult = { interactionId, discordSent: false, slackSent: false, aiRan: false, skipped: false };

  if (!isStepComplete(currentState, "db_queued")) {
    // Try to fetch AI results if available (from bot processor)
    let aiSummary: string | null = null;
    let aiTags: string[] = [];
    try {
      const aiResRaw = await redis.get(`ai_result:${interactionId}`);
      if (aiResRaw) {
        const aiRes = JSON.parse(aiResRaw);
        aiSummary = aiRes.summary;
        aiTags = aiRes.tags || [];
      }
    } catch(e) {}

    const interactionRow: PendingInteractionWrite = {
      interactionId, guildId, channelId, userId, username, commandName, commandOptions,
      status: "PROCESSED", receivedAt: new Date(event.receivedAt), processedAt: new Date(),
      aiSummary, aiTags,
    };
    writer.queueInteraction(interactionRow);

    writer.queueAction({
      interactionId, type: "BOT_REPLY", status: "SUCCESS", payload: { applicationId, channelId }, retryCount: 0, error: null,
    });
    
    const optionText = commandOptions.length > 0 ? commandOptions.map((o) => `${o.name}: ${o.value}`).join(", ") : "no options";
    const mirrorText = `🤖 **/${commandName}** by \`${username}\` in guild \`${guildId ?? "DM"}\` — ${optionText}`;
    writer.queueAction({
      interactionId, type: "MIRROR_SLACK", status: "SUCCESS", payload: { text: mirrorText }, retryCount: 0, error: null,
    });

    if (aiSummary || aiTags.length > 0) {
      writer.queueAction({
        interactionId, type: "AI_TAG", status: "SUCCESS", payload: { summary: aiSummary, tags: aiTags }, retryCount: 0, error: null,
      });
    }

    await advanceState(`db:${interactionId}`, "db_queued");
  }
  
  await advanceState(`db:${interactionId}`, "done");
  return result;
}

// ─── AI Step ─────────────────────────────────────────────────────────────────

interface AiResult {
  summary: string | null;
  answer: string | null;
  tags: string[];
  /** Updated rolling session summary to store back in Redis. */
  updatedSessionSummary: string | null;
  imageUrl?: string | null;
}

/**
 * AI rule for INTERACTION events:
 * - Receives the full session context (previous summary + recent messages)
 * - Summarizes the current command in context
 * - Updates the rolling session summary
 * - Tags with relevant categories
 */
async function runInteractionAi(
  commandName: string,
  optionText: string,
  username: string,
  session: UserSession
): Promise<AiResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { summary: null, answer: null, tags: [], updatedSessionSummary: null };

  try {


    const similarContexts = await fetchSimilarContext(optionText || commandName, 1);
    let vectorContextSection = "";
    let extractedImageUrl: string | null = null;
    
    if (similarContexts.length > 0) {
       const metadata = similarContexts[0].metadata as any;
       vectorContextSection = `\n\n[VECTOR DB MATCH]\nFound relevant factory data:\nName: ${metadata.name}\nDescription: ${metadata.description}\nUsage: ${metadata.mainUsage}\nFunctionality: ${metadata.mainFunctionality}\nPrice: $${metadata.price}\n`;
       if (metadata.imageUrl) extractedImageUrl = metadata.imageUrl;
    }

    const contextSection =
      session.contextMessages.length > 0
        ? `\nPrevious messages in this session:\n${session.contextMessages.map((m, i) => `  ${i + 1}. ${m}`).join("\n")}`
        : "";

    const summarySection = session.recentSummary
      ? `\nSession summary so far: "${session.recentSummary}"`
      : "";

    const prompt = `You are analyzing Discord slash commands for a bot dashboard.

User: "${username}" (session message #${session.messageCount + 1})${summarySection}${contextSection}${vectorContextSection}

Current command: "/${commandName}" with options: "${optionText}"

Respond with JSON only (no markdown):
{
  "summary": "<one sentence: what the user wants right now>",
  "answer": "<direct helpful response to the user's prompt/question, incorporating any VECTOR DB MATCH data if present>",
  "tags": ["<tag1>", "<tag2>"],
  "sessionSummary": "<updated rolling summary of the whole session in one sentence>"
}

Tags must be short lowercase labels: report, status, question, action, config, urgent, followup.
sessionSummary should incorporate context from the full session, not just this message.`;

    const res = await fetch(
      `https://api.groq.com/openai/v1/chat/completions`,
      {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          response_format: { type: "json_object" }
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown");
      console.warn("[processor] AI fetch failed:", res.status, errorText);
      return { summary: null, answer: null, tags: [], updatedSessionSummary: null };
    }

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      summary?: string;
      answer?: string;
      tags?: string[];
      sessionSummary?: string;
    };

    return {
      summary: parsed.summary ?? null,
      answer: parsed.answer ?? null,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      updatedSessionSummary: parsed.sessionSummary ?? null,
      imageUrl: extractedImageUrl,
    };
  } catch (err) {
    console.warn("[processor] AI parsing failed:", err);
    return { summary: null, answer: null, tags: [], updatedSessionSummary: null, imageUrl: null };
  }
}
