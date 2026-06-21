import type { ConversationOccurredEvent, RoomId } from '../../shared/types';

type ConversationDraft = Omit<
  ConversationOccurredEvent,
  'id' | 'runId' | 'ts' | 'simTime' | 'homeId' | 'scenarioId' | 'sequence' | 'rngStateAfter'
>;

export interface ConversationDraftInput {
  conversationId: string;
  currentTime: string;
  speakerId: string;
  listenerIds: string[];
  topic: string;
  intent: string;
  roomId: RoomId;
  summary: string;
  reason?: string;
}

export function createConversationDraft(input: ConversationDraftInput): ConversationDraft {
  return {
    type: 'ConversationOccurred',
    conversationId: input.conversationId,
    speakerId: input.speakerId,
    listenerIds: [...input.listenerIds],
    topic: input.topic,
    intent: input.intent,
    roomId: input.roomId,
    summary: input.summary,
    reason: input.reason,
    sourceLayer: 'truth',
    lineage: {
      eventTime: input.currentTime,
      ingestTime: input.currentTime,
      sourceLayer: 'truth',
      causeEventIds: [],
      episodeId: `conversation:${input.conversationId}`,
      observability: 'private',
      quality: { confidence: 0.92 },
      schemaVersion: 1,
      behaviorModelVersion: 'engine-v1'
    }
  };
}
