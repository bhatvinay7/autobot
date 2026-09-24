export { redis } from "./client";
export {
  STREAMS,
  CONSUMER_GROUP,
  streamPublish,
  streamRead,
  streamReadMultiple,
  streamAck,
  moveToDlq,
  ensureConsumerGroup,
  isDuplicate,
  storeInteractionToken,
  getInteractionToken,
  getStreamDepth,
  getDlqDepth,
} from "./streams";
export type { StreamEntry } from "./streams";

export {
  claimEvent,
  getProcessingState,
  advanceState,
  isStepComplete,
  stateIndex,
} from "./idempotency";

export {
  claimChannel,
  getChannelOwner,
  ownsChannel,
  heartbeatChannels,
  releaseChannel,
  releaseAllChannels,
  OWNERSHIP_TTL_SECONDS,
  HEARTBEAT_INTERVAL_MS,
} from "./channel-affinity";

export {
  getSession,
  saveSession,
  appendToSession,
  createSession,
  clearSession,
  countActiveSessions,
  SESSION_TTL_SECONDS,
  MAX_CONTEXT_MESSAGES,
} from "./session";
