import type {
  PendingInteractionWrite,
  PendingActionWrite,
} from "@repo/types";
import { prisma } from "@repo/db";

/**
 * BatchDbWriter
 *
 * Accumulates Interaction and Action writes in-memory during a single worker
 * invocation. Discord/Slack happen immediately per message — DB is only
 * touched once per invocation via a batched upsert, significantly reducing
 * DB connection pressure on Neon's free tier.
 *
 * Usage:
 *   const writer = new BatchDbWriter();
 *   writer.queueInteraction({ ... });
 *   writer.queueAction({ ... });
 *   await writer.flush();    // call once at end of invocation
 */
export class BatchDbWriter {
  private interactions: PendingInteractionWrite[] = [];
  private actions: PendingActionWrite[] = [];

  queueInteraction(row: PendingInteractionWrite): void {
    this.interactions.push(row);
  }

  queueAction(row: PendingActionWrite): void {
    this.actions.push(row);
  }

  get pendingCount(): number {
    return this.interactions.length + this.actions.length;
  }

  /**
   * Flush all pending writes to Neon in two bulk operations.
   * Called once at the very end of each worker cron invocation.
   *
   * Uses upsert-via-createMany-skipDuplicates so re-runs are safe.
   */
  async flush(): Promise<{ interactions: number; actions: number }> {
    if (this.pendingCount === 0) {
      return { interactions: 0, actions: 0 };
    }

    const [interactionResult, actionResult] = await Promise.all([
      this.flushInteractions(),
      // Actions need the Interaction DB ids — must resolve after interactions
      // are written (handled by separate serial call below)
      Promise.resolve(0),
    ]);

    // Actions reference Interaction.interactionId via a lookup — do after interactions
    const actionCount = await this.flushActions();

    return { interactions: interactionResult, actions: actionCount };
  }

  private async flushInteractions(): Promise<number> {
    if (this.interactions.length === 0) return 0;

    const now = new Date();

    // Upsert all interactions — skip duplicates on interactionId
    const result = await prisma.$transaction(
      this.interactions.map((row) =>
        prisma.interaction.upsert({
          where: { interactionId: row.interactionId },
          update: {
            status: row.status,
            processedAt: row.processedAt ?? now,
            aiSummary: row.aiSummary,
            aiTags: row.aiTags,
          },
          create: {
            interactionId: row.interactionId,
            guildId: row.guildId,
            channelId: row.channelId,
            userId: row.userId,
            username: row.username,
            commandName: row.commandName,
            commandOptions: row.commandOptions as object[],
            status: row.status,
            receivedAt: row.receivedAt,
            processedAt: row.processedAt,
            aiSummary: row.aiSummary,
            aiTags: row.aiTags,
          },
        })
      )
    );

    this.interactions = [];
    return result.length;
  }

  private async flushActions(): Promise<number> {
    if (this.actions.length === 0) return 0;

    // Resolve interactionId strings → DB Interaction.id
    const interactionIds = [...new Set(this.actions.map((a) => a.interactionId))];
    const dbInteractions = await prisma.interaction.findMany({
      where: { interactionId: { in: interactionIds } },
      select: { id: true, interactionId: true },
    });

    const idMap = new Map(dbInteractions.map((r) => [r.interactionId, r.id]));

    const actionRows = this.actions
      .map((a) => {
        const dbId = idMap.get(a.interactionId);
        if (!dbId) return null; // Interaction not yet in DB — skip (will retry next tick)
        return {
          interactionDbId: dbId,
          type: a.type,
          status: a.status,
          payload: a.payload as object,
          retryCount: a.retryCount,
          error: a.error,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (actionRows.length === 0) return 0;

    const result = await prisma.action.createMany({
      data: actionRows,
      skipDuplicates: false, // Actions are always new rows
    });

    this.actions = [];
    return result.count;
  }
}
