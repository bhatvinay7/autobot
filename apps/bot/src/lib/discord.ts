import { PermanentError } from "./retry";

/**
 * Discord REST API helper — sends follow-up messages using the interaction token
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#followup-messages
 */

const DISCORD_API = "https://discord.com/api/v10";

interface DiscordFollowUpBody {
  content: string;
  flags?: number;
}

export async function sendDiscordFollowUp(
  applicationId: string,
  token: string,
  content: string,
  ephemeral = false
): Promise<void> {
  const body: DiscordFollowUpBody = {
    content,
    ...(ephemeral && { flags: 64 }),
  };

  const res = await fetch(
    `${DISCORD_API}/webhooks/${applicationId}/${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    // 4xx are permanent (invalid token, unknown webhook) — don't retry
    if (res.status >= 400 && res.status < 500) {
      throw new PermanentError(`Discord follow-up failed [${res.status}]: ${text}`);
    }
    throw new Error(`Discord follow-up failed [${res.status}]: ${text}`);
  }
}

export async function sendDiscordChannelMessage(
  channelId: string,
  content: string
): Promise<void> {
  const botToken = process.env.DISCORD_TOKEN;
  if (!botToken) throw new Error("DISCORD_TOKEN is not set");

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord channel message failed [${res.status}]: ${text}`);
  }
}
