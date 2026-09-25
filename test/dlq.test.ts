import { describe, expect, test, mock } from "bun:test";
process.env.REDIS_URL = "redis://localhost:6379";
import { moveToDlq } from "../packages/redis/src/streams";

import type { QueueEvent } from "@repo/types";

const mockRedis = {
  xadd: mock(async () => "dlq-id"),
  xack: mock(async () => 1)
};

mock.module("../packages/redis/src/client", () => {
  return { redis: mockRedis };
});

describe("DLQ Log", () => {
  test("moves message to DLQ and ACKs from original stream", async () => {
    const event = { kind: "INTERACTION", interactionId: "123" } as unknown as QueueEvent;
    
    await moveToDlq("interactions", "msg_1", event, new Error("Test Error"), "channel_1");
    
    // verify xadd to dlq
    expect(mockRedis.xadd).toHaveBeenCalled();
    const xaddCalls = mockRedis.xadd.mock.calls;
    expect(xaddCalls[0][0]).toBe("stream:dlq");
    
    // verify payload includes error
    const payload = JSON.parse(xaddCalls[0][3] as string);
    expect(payload.originalStream).toBe("interactions");
    expect(payload.error).toBe("Test Error");
    
    // verify xack
    expect(mockRedis.xack).toHaveBeenCalled();
  });
});
