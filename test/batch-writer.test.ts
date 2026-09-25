import { describe, expect, test, mock } from "bun:test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.DATABASE_URL = "postgresql://dummy";

// Mock prisma
const mockPrisma = {
  $transaction: mock(async (queries: any[]) => {
    return Promise.all(queries);
  }),
  interaction: {
    upsert: mock(() => "upsert_query"),
    findMany: mock(async () => [{ id: "db_1", interactionId: "int_1" }]),
  },
  action: {
    createMany: mock(() => "create_many_query"),
  }
};

mock.module("@repo/db", () => {
  return {
    prisma: mockPrisma
  };
});

const { BatchDbWriter } = require("../apps/bot/src/lib/batch-writer");

describe("Event Log / BatchDbWriter", () => {
  test("batches DB writes and flushes properly", async () => {
    const writer = new BatchDbWriter();
    
    // Enqueue an event
    writer.queueInteraction({
      interactionId: "int_1",
      guildId: "guild_1",
      channelId: "channel_1",
      userId: "user_1",
      username: "testuser",
      commandName: "test",
      status: "PROCESSED",
      receivedAt: new Date().toISOString(),
      processedAt: new Date().toISOString()
    });

    writer.queueAction({
      id: "act_1",
      interactionId: "int_1",
      type: "DISCORD_REPLY",
      status: "SUCCESS",
      retryCount: 0,
      createdAt: new Date().toISOString()
    });

    expect(writer.pendingCount).toBe(2);
    
    // Flush
    await writer.flush();
    expect(writer.pendingCount).toBe(0);

    // Ensure transaction was called
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });
});
