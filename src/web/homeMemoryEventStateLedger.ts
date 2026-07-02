import type { DeviceValueEvent } from './deviceEventSocket';
import {
  createHomeMemory,
  getTimeBucket,
  reduceDeviceEvents,
  type ActivityEpisode,
  type FieldMemory,
  type HomeMemory,
  type MemoryEpisode,
  type MemoryEvidence,
  type SemanticSignal
} from './homeMemoryModel';
import { createHomeProfileHypotheses, type ProfileHypothesis } from './homeProfiler';

export interface EventStateLedger {
  eventId: string;
  title: string;
  selectedEvent: DeviceValueEvent;
  steps: EventStateLedgerStep[];
  relatedHypotheses: ProfileHypothesis[];
}

export interface EventStateLedgerStep {
  id: string;
  title: string;
  narration: string;
  formula: string;
  why: string;
  metrics: Array<{ label: string; value: string; note?: string }>;
  changes: EventStateChange[];
  relatedHypothesisIds?: string[];
}

export interface EventStateChange {
  path: string;
  before: string;
  after: string;
  formula: string;
  why: string;
}

const STEP_TITLES = [
  '1. Raw Event',
  '2. Run / Time',
  '3. Classification',
  '4. Change Analysis',
  '5. MemoryEvidence',
  '6. FieldMemory',
  '7. DeviceMemory',
  '8. RoomMemory',
  '9. Low-Level Episode',
  '10. Daily / Weekly Summary',
  '11. Semantic Signal',
  '12. Activity Episode',
  '13. HomeMemory Root',
  '14. Hypothesis Impact'
] as const;

export function createEventStateLedger(events: DeviceValueEvent[], eventId: string): EventStateLedger | null {
  const sortedEvents = [...events].sort(compareEvents);
  const selectedIndex = sortedEvents.findIndex((event) => event.id === eventId);
  if (selectedIndex < 0) {
    return null;
  }

  const selectedEvent = sortedEvents[selectedIndex];
  const eventsBefore = sortedEvents.slice(0, selectedIndex);
  const memoryBefore = reduceDeviceEvents(createHomeMemory(), eventsBefore);
  const memoryAfter = reduceDeviceEvents(memoryBefore, [selectedEvent]);
  const evidence = memoryAfter.recentEvents.find((candidate) => candidate.id === selectedEvent.id);
  if (!evidence) {
    return null;
  }

  const fieldId = getFieldId(selectedEvent);
  const fieldBefore = memoryBefore.fields[fieldId];
  const fieldAfter = memoryAfter.fields[fieldId];
  const deviceBefore = memoryBefore.devices[selectedEvent.deviceId];
  const deviceAfter = memoryAfter.devices[selectedEvent.deviceId];
  const roomBefore = memoryBefore.rooms[selectedEvent.roomId];
  const roomAfter = memoryAfter.rooms[selectedEvent.roomId];
  const semanticSignals = memoryAfter.semanticSignals.filter((signal) => signal.sourceEvidenceIds.includes(evidence.id));
  const lowLevelEpisodes = relatedEpisodes(memoryAfter, evidence.id);
  const activityEpisodes = relatedActivityEpisodes(memoryAfter, evidence.id, semanticSignals);
  const relatedHypotheses = relatedProfileHypotheses(memoryAfter, selectedEvent, evidence, semanticSignals);

  const steps = buildSteps({
    selectedEvent,
    memoryBefore,
    memoryAfter,
    evidence,
    fieldId,
    fieldBefore,
    fieldAfter,
    deviceBefore,
    deviceAfter,
    roomBefore,
    roomAfter,
    semanticSignals,
    lowLevelEpisodes,
    activityEpisodes,
    relatedHypotheses
  });

  return {
    eventId,
    title: `${selectedEvent.deviceId}.${selectedEvent.field} -> ${formatValue(selectedEvent.value)}`,
    selectedEvent,
    steps,
    relatedHypotheses
  };
}

interface StepContext {
  selectedEvent: DeviceValueEvent;
  memoryBefore: HomeMemory;
  memoryAfter: HomeMemory;
  evidence: MemoryEvidence;
  fieldId: string;
  fieldBefore: FieldMemory | undefined;
  fieldAfter: FieldMemory | undefined;
  deviceBefore: HomeMemory['devices'][string] | undefined;
  deviceAfter: HomeMemory['devices'][string] | undefined;
  roomBefore: HomeMemory['rooms'][string] | undefined;
  roomAfter: HomeMemory['rooms'][string] | undefined;
  semanticSignals: SemanticSignal[];
  lowLevelEpisodes: MemoryEpisode[];
  activityEpisodes: ActivityEpisode[];
  relatedHypotheses: ProfileHypothesis[];
}

function buildSteps(context: StepContext): EventStateLedgerStep[] {
  return [
    rawEventStep(context),
    runTimeStep(context),
    classificationStep(context),
    changeAnalysisStep(context),
    memoryEvidenceStep(context),
    fieldMemoryStep(context),
    deviceMemoryStep(context),
    roomMemoryStep(context),
    lowLevelEpisodeStep(context),
    summaryStep(context),
    semanticSignalStep(context),
    activityEpisodeStep(context),
    homeMemoryRootStep(context),
    hypothesisImpactStep(context)
  ].map((step, index) => ({ ...step, id: String(index + 1), title: STEP_TITLES[index] }));
}

function rawEventStep({ selectedEvent }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: `原始事件进入账本：${selectedEvent.deviceId}.${selectedEvent.field} 上报为 ${formatValue(selectedEvent.value)}。`,
    formula: 'selectedEvent = sort(events, sequence, id).find(id)',
    why: '先固定被讲解的事件，后续每一步都只解释这个事件如何改变记忆状态。',
    metrics: [
      { label: 'Event id', value: selectedEvent.id },
      { label: 'Device field', value: `${selectedEvent.deviceId}.${selectedEvent.field}` },
      { label: 'Value', value: formatValue(selectedEvent.value) }
    ],
    changes: []
  };
}

function runTimeStep({ selectedEvent }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  const bucket = getTimeBucket(selectedEvent.simTime);
  return {
    narration: `事件属于 run ${selectedEvent.runId}，sequence=${selectedEvent.sequence}，演示时间落在 ${bucket}。`,
    formula: 'timeBucket = getTimeBucket(event.simTime)',
    why: 'run、sequence 和时间桶决定重放顺序，也会进入日/周摘要与节律假设。',
    metrics: [
      { label: 'Run id', value: selectedEvent.runId },
      { label: 'Sequence', value: String(selectedEvent.sequence) },
      { label: 'Time bucket', value: bucket },
      { label: 'Sim time', value: selectedEvent.simTime }
    ],
    changes: []
  };
}

function classificationStep({ evidence }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: `分类器把事件识别为 ${evidence.capability.type}，证据类别是 ${evidence.evidenceCategory}，基础画像权重是 ${formatNumber(evidence.profileWeight)}。`,
    formula: 'classification = classifyDeviceEvidence(event)',
    why: evidence.evidenceReason,
    metrics: [
      { label: 'Capability', value: evidence.capability.type },
      { label: 'Evidence category', value: evidence.evidenceCategory },
      { label: 'Evidence strength', value: evidence.evidenceStrength },
      { label: 'Base weight', value: formatNumber(evidence.profileWeight) }
    ],
    changes: []
  };
}

function changeAnalysisStep({ selectedEvent, fieldBefore, evidence }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  const previousValue = fieldBefore?.currentValue;
  const thresholdNote = evidence.valueDelta !== undefined && evidence.evidenceCategory === 'environment_context'
    ? '环境 telemetry 需要 delta >= 0.5 才算 meaningfulChange。'
    : '非环境数值变化或离散状态变化按 reducer 的 meaningfulChange 规则处理。';

  return {
    narration: `变化分析比较 before=${formatValue(previousValue)} 与 after=${formatValue(selectedEvent.value)}。${thresholdNote}`,
    formula: 'profileWeight = meaningfulChange ? baseWeight : 0',
    why: evidence.meaningfulChange ? '这次事件改变了可解释状态，所以进入画像权重。' : '这是重复或小幅环境 telemetry，只更新事实记忆，不增加画像权重。',
    metrics: [
      { label: 'Previous value', value: formatValue(previousValue) },
      { label: 'Current value', value: formatValue(selectedEvent.value) },
      ...(evidence.valueDelta === undefined ? [] : [{ label: 'Value delta', value: formatNumber(evidence.valueDelta) }]),
      { label: 'Meaningful change', value: String(evidence.meaningfulChange) },
      { label: 'Profile weight', value: formatNumber(evidence.profileWeight) }
    ],
    changes: [
      change('field.currentValue', previousValue, selectedEvent.value, 'after = event.value', '字段事实值被最新事件覆盖。'),
      change('profileWeight', 0, evidence.profileWeight, 'meaningfulChange ? baseWeight : 0', '当前事件对画像的增量贡献。')
    ]
  };
}

function memoryEvidenceStep({ memoryBefore, memoryAfter, evidence }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: `MemoryEvidence 把原始事件固化成可审计证据：${evidence.id}，meaningfulChange=${evidence.meaningfulChange}。`,
    formula: 'evidence = toEvidence(event, timeBucket, classification, change)',
    why: '证据对象是 reducer 后续写入 field/device/room/root/hypothesis 的共同来源。',
    metrics: [
      { label: 'Evidence id', value: evidence.id },
      { label: 'Source event id', value: evidence.sourceEventId },
      { label: 'Category', value: evidence.evidenceCategory },
      { label: 'Weight', value: formatNumber(evidence.profileWeight) }
    ],
    changes: [
      change('recentEvents.length', memoryBefore.recentEvents.length, memoryAfter.recentEvents.length, 'appendBounded(recentEvents, evidence).length', '根记忆保留最近证据，方便审计与假设引用。')
    ]
  };
}

function fieldMemoryStep({ fieldId, fieldBefore, fieldAfter, evidence }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: `FieldMemory 聚合 ${fieldId} 的字段历史，事件数、变化数和 telemetry 数在这里分账。`,
    formula: 'fields[fieldId] = updateFieldMemory(previousField, event, evidence, fieldId)',
    why: '字段层负责保存当前值、上一值、计数和字段级画像权重。',
    metrics: [
      { label: 'Field id', value: fieldId },
      { label: 'Events', value: formatTransition(fieldBefore?.eventCount ?? 0, fieldAfter?.eventCount ?? 0) },
      { label: 'Change count', value: formatTransition(fieldBefore?.changeCount ?? 0, fieldAfter?.changeCount ?? 0) },
      { label: 'Telemetry count', value: formatTransition(fieldBefore?.telemetryCount ?? 0, fieldAfter?.telemetryCount ?? 0) }
    ],
    changes: [
      change('field.eventCount', fieldBefore?.eventCount ?? 0, fieldAfter?.eventCount ?? 0, 'eventCount + 1', '字段收到一次新观测。'),
      change('field.profileEvidenceWeight', fieldBefore?.profileEvidenceWeight ?? 0, fieldAfter?.profileEvidenceWeight ?? 0, '+ evidence.profileWeight', evidence.profileWeight > 0 ? '画像证据累计增加。' : '无 meaningfulChange，因此画像证据不增加。')
    ]
  };
}

function deviceMemoryStep({ selectedEvent, deviceBefore, deviceAfter }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: `DeviceMemory 更新 ${selectedEvent.deviceId} 的最新字段值和设备级累计证据。`,
    formula: 'devices[event.deviceId] = updateDeviceMemory(previousDevice, event, evidence, fieldId, timeBucket)',
    why: '设备层让 UI 能按设备查看最新状态与画像贡献。',
    metrics: [
      { label: 'Device id', value: selectedEvent.deviceId },
      { label: 'Events', value: formatTransition(deviceBefore?.eventCount ?? 0, deviceAfter?.eventCount ?? 0) },
      { label: 'Fields', value: String(deviceAfter?.fields.length ?? 0) },
      { label: 'Profile weight', value: formatTransition(deviceBefore?.profileEvidenceWeight ?? 0, deviceAfter?.profileEvidenceWeight ?? 0) }
    ],
    changes: [
      change(`device.latestValues.${selectedEvent.field}`, deviceBefore?.latestValues[selectedEvent.field], deviceAfter?.latestValues[selectedEvent.field], 'latestValues[field] = event.value', '设备最新状态指向当前事件值。')
    ]
  };
}

function roomMemoryStep({ selectedEvent, roomBefore, roomAfter }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: `RoomMemory 把 ${selectedEvent.roomId} 房间中的设备活动和画像证据一起累计。`,
    formula: 'rooms[event.roomId] = updateRoomMemory(previousRoom, event, evidence, fieldId, timeBucket)',
    why: '房间层为房间习惯、在家活动和家庭规模假设提供输入。',
    metrics: [
      { label: 'Room id', value: selectedEvent.roomId },
      { label: 'Events', value: formatTransition(roomBefore?.eventCount ?? 0, roomAfter?.eventCount ?? 0) },
      { label: 'Devices', value: String(roomAfter?.devices.length ?? 0) },
      { label: 'Profile weight', value: formatTransition(roomBefore?.profileEvidenceWeight ?? 0, roomAfter?.profileEvidenceWeight ?? 0) }
    ],
    changes: [
      change('room.eventCount', roomBefore?.eventCount ?? 0, roomAfter?.eventCount ?? 0, 'eventCount + 1', '房间收到一次新观测。')
    ]
  };
}

function lowLevelEpisodeStep({ lowLevelEpisodes }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: lowLevelEpisodes.length > 0
      ? `低层 episode 收到 ${lowLevelEpisodes.length} 个关联片段，最近片段是 ${lowLevelEpisodes[0].kind}/${lowLevelEpisodes[0].status}。`
      : '这次事件没有启动或更新低层 episode，只保留为事实证据。',
    formula: 'episodes = updateEpisodeMemory(memory, event, evidence, fieldId, timeBucket)',
    why: '低层片段把连续的门磁、运动、用电等状态合并成行为片段。',
    metrics: [
      { label: 'Related episodes', value: String(lowLevelEpisodes.length) },
      { label: 'Kinds', value: lowLevelEpisodes.map((episode) => episode.kind).join(', ') || 'none' }
    ],
    changes: []
  };
}

function summaryStep({ selectedEvent, memoryBefore, memoryAfter }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: '日摘要和周摘要同步吸收这条证据，用来支撑更长窗口的节律判断。',
    formula: 'dailySummaries/date and weeklySummaries/week += event/evidence',
    why: '摘要让画像不只看最近事件，也能看跨天、跨周的稳定模式。',
    metrics: [
      { label: 'Daily summaries', value: formatTransition(memoryBefore.dailySummaryCount, memoryAfter.dailySummaryCount) },
      { label: 'Weekly summaries', value: formatTransition(memoryBefore.weeklySummaryCount, memoryAfter.weeklySummaryCount) },
      { label: 'Summary date', value: selectedEvent.simTime.slice(0, 10) }
    ],
    changes: [
      change('dailySummaryCount', memoryBefore.dailySummaryCount, memoryAfter.dailySummaryCount, 'Object.keys(dailySummaries).length', '必要时创建当天摘要。'),
      change('weeklySummaryCount', memoryBefore.weeklySummaryCount, memoryAfter.weeklySummaryCount, 'Object.keys(weeklySummaries).length', '必要时创建当周摘要。')
    ]
  };
}

function semanticSignalStep({ memoryBefore, memoryAfter, evidence, semanticSignals }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: semanticSignals.length > 0
      ? `语义层生成 ${semanticSignals.map((signal) => signal.type).join(', ')}，把事实证据翻译成生活语义。`
      : `meaningfulChange=false，所以没有生成新的生活语义；重复/小幅环境 telemetry 只更新事实记忆。`,
    formula: 'semanticSignals = meaningfulChange ? semanticSignalsForEvidence(event, evidence) : []',
    why: evidence.meaningfulChange ? '有意义变化才会产生生活语义信号。' : '没有 meaningfulChange 时不应把环境波动误解成生活行为。',
    metrics: [
      { label: 'Signals', value: String(semanticSignals.length) },
      { label: 'Types', value: semanticSignals.map((signal) => signal.type).join(', ') || 'none' },
      { label: 'Meaningful change', value: String(evidence.meaningfulChange) }
    ],
    changes: [
      change('semanticSignals.length', memoryBefore.semanticSignals.length, memoryAfter.semanticSignals.length, 'appendManyBounded(semanticSignals, newSignals).length', '语义信号供活动片段和画像假设使用。')
    ]
  };
}

function activityEpisodeStep({ activityEpisodes }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: activityEpisodes.length > 0
      ? `活动 episode 关联到 ${activityEpisodes.map((episode) => episode.kind).join(', ')}。`
      : '这次事件没有形成新的高层活动 episode。',
    formula: 'activityEpisodes = updateActivityEpisodes(memory, semanticSignals)',
    why: '高层活动片段需要语义信号组合，单条弱 telemetry 通常不会形成活动。',
    metrics: [
      { label: 'Activity episodes', value: String(activityEpisodes.length) },
      { label: 'Kinds', value: activityEpisodes.map((episode) => episode.kind).join(', ') || 'none' }
    ],
    changes: []
  };
}

function homeMemoryRootStep({ memoryBefore, memoryAfter }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  return {
    narration: 'HomeMemory 根节点累计全局计数、最近证据和画像权重，是白盒解释的入口。',
    formula: 'homeMemory = reduceDeviceEvents(memoryBefore, [selectedEvent])',
    why: '根状态让 UI 能从一个事件跳到房间、设备、字段、语义和假设。',
    metrics: [
      { label: 'Total events', value: formatTransition(memoryBefore.totalEvents, memoryAfter.totalEvents) },
      { label: 'Recent events', value: formatTransition(memoryBefore.recentEvents.length, memoryAfter.recentEvents.length) },
      { label: 'Profile event count', value: formatTransition(memoryBefore.profileEventCount, memoryAfter.profileEventCount) },
      { label: 'Profile weight', value: formatTransition(memoryBefore.profileEvidenceWeight, memoryAfter.profileEvidenceWeight) }
    ],
    changes: [
      change('totalEvents', memoryBefore.totalEvents, memoryAfter.totalEvents, 'totalEvents + 1', '根记忆记录处理进度。'),
      change('profileEvidenceWeight', memoryBefore.profileEvidenceWeight, memoryAfter.profileEvidenceWeight, '+ evidence.profileWeight', '全局画像权重只随当前事件贡献增加。')
    ]
  };
}

function hypothesisImpactStep({ relatedHypotheses }: StepContext): Omit<EventStateLedgerStep, 'id' | 'title'> {
  const ids = relatedHypotheses.map((hypothesis) => hypothesis.id);
  return {
    narration: ids.length > 0
      ? `相关画像假设被挂接到本事件：${ids.join(', ')}。`
      : '当前事件暂时没有命中任何画像假设。',
    formula: 'relatedHypotheses = hypotheses.filter(evidence/subject/signal match)',
    why: '假设影响只展示能被这条事件、房间、设备、字段或语义来源解释到的结论。',
    metrics: [
      { label: 'Related hypotheses', value: String(ids.length) },
      { label: 'Ids', value: ids.join(', ') || 'none' }
    ],
    changes: [],
    relatedHypothesisIds: ids
  };
}

function relatedProfileHypotheses(
  memoryAfter: HomeMemory,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  semanticSignals: SemanticSignal[]
): ProfileHypothesis[] {
  const hypotheses = createHomeProfileHypotheses(memoryAfter);
  const subjectIds = new Set([
    `room:${event.roomId}`,
    `device:${event.deviceId}`,
    `field:${getFieldId(event)}`
  ]);
  const signalEvidenceIds = new Set(semanticSignals.flatMap((signal) => signal.sourceEvidenceIds));

  return hypotheses.filter((hypothesis) => {
    const hypothesisEvidence = [
      ...hypothesis.evidence,
      ...hypothesis.supportingEvidence,
      ...hypothesis.contradictingEvidence
    ];
    return (
      hypothesisEvidence.some((candidate) => candidate.id === evidence.id || candidate.sourceEventId === event.id) ||
      hypothesis.subjectIds.some((subjectId) => subjectIds.has(subjectId)) ||
      hypothesisEvidence.some((candidate) => signalEvidenceIds.has(candidate.id))
    );
  });
}

function relatedEpisodes(memory: HomeMemory, evidenceId: string): MemoryEpisode[] {
  return Object.values(memory.episodes)
    .filter((episode) => episode.evidenceIds.includes(evidenceId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

function relatedActivityEpisodes(
  memory: HomeMemory,
  evidenceId: string,
  semanticSignals: SemanticSignal[]
): ActivityEpisode[] {
  const semanticSignalIds = new Set(semanticSignals.map((signal) => signal.id));
  return memory.activityEpisodes
    .filter((episode) => episode.evidenceIds.includes(evidenceId) || episode.semanticSignalIds.some((id) => semanticSignalIds.has(id)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

function compareEvents(left: DeviceValueEvent, right: DeviceValueEvent): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id);
}

function getFieldId(event: Pick<DeviceValueEvent, 'deviceId' | 'field'>): string {
  return `${event.deviceId}:${event.field}`;
}

function change(path: string, before: unknown, after: unknown, formula: string, why: string): EventStateChange {
  return {
    path,
    before: formatValue(before),
    after: formatValue(after),
    formula,
    why
  };
}

function formatTransition(before: unknown, after: unknown): string {
  return `${formatValue(before)} -> ${formatValue(after)}`;
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return 'none';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  return String(value);
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
