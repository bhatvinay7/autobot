import { PermanentError } from "./retry";

/**
 * Slack Incoming Webhook helper
 * Sends a notification to the configured Slack channel.
 */
export async function sendSlackNotification(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new PermanentError("SLACK_WEBHOOK_URL is not set");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    // 4xx are permanent, 5xx can be retried
    if (res.status >= 400 && res.status < 500) {
      throw new PermanentError(`Slack webhook failed [${res.status}]: ${body}`);
    }
    throw new Error(`Slack webhook failed [${res.status}]: ${body}`);
  }
}
