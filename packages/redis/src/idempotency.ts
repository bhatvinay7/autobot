import type { ProcessingState } from "@repo/types";
import { redis } from "./client";
import Redis from "ioredis";

/**
 * Generic Redis State Machine
 * 
 * This class abstracts the idempotency logic into a standalone, reusable 
 * component. It allows distributed microservices to safely step through a
 * defined array of states without race conditions or double-processing.
 */
export class RedisStateMachine<T extends readonly string[]> {
  constructor(
    private config: {
      redisClient: Redis;
      prefix: string;
      states: T;
      claimTtlSeconds: number;
      doneTtlSeconds: number;
      terminalState: T[number];
    }
  ) {}

  private key(id: string): string {
    return `${this.config.prefix}${id}`;
  }

  /**
   * Attempt to claim an event for processing.
   * Uses SET NX to ensure only one worker claims the initial state.
   */
  async claim(id: string): Promise<boolean> {
    const initialState = this.config.states[0];
    if (!initialState) throw new Error("State machine must have at least one state");
    
    const result = await this.config.redisClient.set(
      this.key(id),
      initialState as string,
      "EX",
      this.config.claimTtlSeconds,
      "NX"
    );
    return result === "OK";
  }

  /**
   * Read the current processing state.
   * Returns null if no state exists (never seen, or TTL expired).
   */
  async getState(id: string): Promise<T[number] | null> {
    const val = await this.config.redisClient.get(this.key(id));
    return val as T[number] | null;
  }

  /**
   * Advance the processing state.
   * Extends the TTL back to claimTtlSeconds unless the state is terminal,
   * in which case the TTL is set to doneTtlSeconds for long-term dedup.
   */
  async advance(id: string, newState: T[number]): Promise<void> {
    const ttl = newState === this.config.terminalState 
      ? this.config.doneTtlSeconds 
      : this.config.claimTtlSeconds;
    
    await this.config.redisClient.set(this.key(id), newState as string, "EX", ttl);
  }

  /**
   * Get the numerical index of a state in the state machine.
   */
  indexOf(state: T[number]): number {
    return this.config.states.indexOf(state);
  }

  /**
   * Check whether a given step has already been completed.
   * Uses the state ordering to determine if the current state is logically 
   * at or past the target state.
   */
  isComplete(current: T[number] | null, target: T[number]): boolean {
    if (current === null) return false;
    return this.indexOf(current) >= this.indexOf(target);
  }
}

// ─── Legacy Wrapper for the Bot App ──────────────────────────────────────────

const APP_STATES = [
  "claimed",
  "discord_done",
  "slack_done",
  "ai_done",
  "db_queued",
  "done",
] as const;

// We instantiate the generic machine specifically for our app's interaction pipeline
const appStateMachine = new RedisStateMachine({
  redisClient: redis as unknown as Redis, // Assuming exported redis is ioredis
  prefix: "proc:",
  states: APP_STATES,
  claimTtlSeconds: 60,
  doneTtlSeconds: 86_400,
  terminalState: "done",
});

// Re-export the existing API so we don't break the codebase
export async function claimEvent(eventId: string): Promise<boolean> {
  return appStateMachine.claim(eventId);
}

export async function getProcessingState(eventId: string): Promise<ProcessingState | null> {
  return appStateMachine.getState(eventId) as Promise<ProcessingState | null>;
}

export async function advanceState(eventId: string, state: ProcessingState): Promise<void> {
  return appStateMachine.advance(eventId, state);
}

export function stateIndex(state: ProcessingState): number {
  return appStateMachine.indexOf(state);
}

export function isStepComplete(current: ProcessingState | null, target: ProcessingState): boolean {
  return appStateMachine.isComplete(current, target);
}
