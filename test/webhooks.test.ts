import { describe, expect, test, mock, beforeEach } from "bun:test";
process.env.REDIS_URL = "redis://localhost:6379";
import { POST } from "../apps/ingestion/src/app/api/interactions/route";

mock.module("../apps/ingestion/src/lib/verify", () => ({
  verifyDiscordSignature: mock((body: string, sig: string, time: string) => {
    return sig === "valid_sig";
  })
}));

mock.module("@repo/redis", () => {
  return {
    redis: {
      set: mock(async () => "OK")
    },
    isDuplicate: mock(async () => false),
    storeInteractionToken: mock(async () => {}),
    streamPublish: mock(async () => "123-0")
  };
});

describe("Discord Webhooks (Ingestion)", () => {
  test("returns 401 on invalid signature", async () => {
    const req = new Request("http://localhost/api/interactions", {
      method: "POST",
      headers: {
        "x-signature-ed25519": "invalid_sig",
        "x-signature-timestamp": "1234567890",
      },
      body: JSON.stringify({ type: 1 })
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("handles PING (type 1)", async () => {
    const req = new Request("http://localhost/api/interactions", {
      method: "POST",
      headers: {
        "x-signature-ed25519": "valid_sig",
        "x-signature-timestamp": "1234567890",
      },
      body: JSON.stringify({ type: 1 })
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe(1); // PONG
  });

  test("handles Slash Commands (type 2) and triggers worker async", async () => {
    const req = new Request("http://localhost/api/interactions", {
      method: "POST",
      headers: {
        "x-signature-ed25519": "valid_sig",
        "x-signature-timestamp": "1234567890",
      },
      body: JSON.stringify({
        type: 2,
        id: "interaction_123",
        token: "token_123",
        channel_id: "channel_abc",
        data: { name: "test" }
      })
    });

    // Mock global fetch for the fire-and-forget lambda trigger
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => new Response("OK")) as typeof fetch;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe(5); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

    // restore fetch
    globalThis.fetch = originalFetch;
  });
});
