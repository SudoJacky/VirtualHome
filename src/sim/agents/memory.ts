import type { TwinEvent } from '../../shared/types';

export interface MemoryCount {
  count: number;
}

export interface ActivityMemory extends MemoryCount {
  activityId: string;
}

export interface SocialTopicMemory extends MemoryCount {
  topic: string;
}

export interface AgentMemorySummary {
  personId: string;
  topActivities: ActivityMemory[];
  socialTopics: SocialTopicMemory[];
  summary: string;
}

export function summarizeAgentMemory(personId: string, events: TwinEvent[]): AgentMemorySummary {
  const activityCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  for (const event of events) {
    if (event.sourceLayer !== 'truth') {
      continue;
    }
    if (event.type === 'ActivityStarted' && event.participants.includes(personId)) {
      activityCounts[event.activityId] = (activityCounts[event.activityId] ?? 0) + 1;
    }
    if (event.type === 'ConversationOccurred' && (event.speakerId === personId || event.listenerIds.includes(personId))) {
      topicCounts[event.topic] = (topicCounts[event.topic] ?? 0) + 1;
    }
  }

  const topActivities = rankActivityCounts(activityCounts);
  const socialTopics = rankTopicCounts(topicCounts);
  return {
    personId,
    topActivities,
    socialTopics,
    summary: createMemoryText(personId, topActivities, socialTopics)
  };
}

function rankActivityCounts(record: Record<string, number>): ActivityMemory[] {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([activityId, count]) => ({ activityId, count }));
}

function rankTopicCounts(record: Record<string, number>): SocialTopicMemory[] {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));
}

function createMemoryText(personId: string, activities: ActivityMemory[], topics: SocialTopicMemory[]): string {
  if (activities.length === 0 && topics.length === 0) {
    return `No repeated memories yet for ${personId}.`;
  }
  const parts = [];
  if (activities.length > 0) {
    parts.push(`frequent activities: ${activities.map((activity) => `${activity.activityId} x${activity.count}`).join(', ')}`);
  }
  if (topics.length > 0) {
    parts.push(`recurring social topics: ${topics.map((topic) => `${topic.topic} x${topic.count}`).join(', ')}`);
  }
  return `${personId} memory summary: ${parts.join('; ')}.`;
}
