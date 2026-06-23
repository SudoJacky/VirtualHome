import { describe, expect, it } from 'vitest';
import { summarizeAgentMemory } from '../src/sim/agents/memory';
import type { ActivityStartedEvent, ConversationOccurredEvent } from '../src/shared/types';

const baseEvent = {
  id: 'evt_001',
  runId: 'run_001',
  ts: '2026-06-17T18:30:00+08:00',
  simTime: '2026-06-17T18:30:00+08:00',
  homeId: 'default_home',
  scenarioId: 'weekday_normal',
  sequence: 1,
  rngStateAfter: 123,
  sourceLayer: 'truth' as const,
  lineage: {
    eventTime: '2026-06-17T18:30:00+08:00',
    ingestTime: '2026-06-17T18:30:00+08:00',
    sourceLayer: 'truth' as const,
    causeEventIds: [],
    episodeId: 'test',
    observability: 'private' as const,
    quality: {},
    schemaVersion: 1,
    behaviorModelVersion: 'test'
  }
};

function activity(activityId: string, participant: string, sequence: number): ActivityStartedEvent {
  return {
    ...baseEvent,
    id: `activity_${sequence}`,
    sequence,
    type: 'ActivityStarted',
    activityId,
    participants: [participant],
    roomId: activityId === 'study_homework' ? 'living_room' : 'kitchen'
  };
}

function conversation(topic: string, speakerId: string, listenerIds: string[], sequence: number): ConversationOccurredEvent {
  return {
    ...baseEvent,
    id: `conversation_${sequence}`,
    sequence,
    type: 'ConversationOccurred',
    conversationId: `conversation_${sequence}`,
    speakerId,
    listenerIds,
    topic,
    intent: topic,
    roomId: 'living_room',
    summary: `${speakerId} discussed ${topic} with ${listenerIds.join(', ')}.`
  };
}

describe('agent memory', () => {
  it('summarizes activity habits and social reminders per person', () => {
    const memory = summarizeAgentMemory('child_1', [
      activity('study_homework', 'child_1', 1),
      activity('study_homework', 'child_1', 2),
      activity('watch_tv', 'child_1', 3),
      conversation('homework_reminder', 'adult_1', ['child_1'], 4)
    ]);

    expect(memory.personId).toBe('child_1');
    expect(memory.topActivities[0]).toMatchObject({
      activityId: 'study_homework',
      count: 2
    });
    expect(memory.socialTopics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        topic: 'homework_reminder',
        count: 1
      })
    ]));
    expect(memory.summary).toContain('study_homework');
    expect(memory.summary).toContain('homework_reminder');
  });

  it('ignores other people when building a person memory summary', () => {
    const memory = summarizeAgentMemory('adult_2', [
      activity('study_homework', 'child_1', 1),
      conversation('homework_reminder', 'adult_1', ['child_1'], 2)
    ]);

    expect(memory.topActivities).toEqual([]);
    expect(memory.socialTopics).toEqual([]);
    expect(memory.summary).toBe('No repeated memories yet for adult_2.');
  });
});
