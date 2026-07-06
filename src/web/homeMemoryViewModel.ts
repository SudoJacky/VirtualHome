import type { DeviceEventValue } from './deviceEventSocket';
import type { HomeMemory, SemanticSignal } from './homeMemoryModel';
import { createEventEvidenceFlow, createHypothesisWhiteBoxTrace, type HypothesisWhiteBoxTrace } from './homeMemoryReasoning';
import type { MemoryLocale } from './homeMemoryI18n';
import type { ProfileHypothesis } from './homeProfiler';

export interface SemanticSignalRow {
  id: string;
  typeLabel: string;
  location: string;
  source: string;
  value: string;
  strength: string;
  weight: string;
  time: string;
  reason: string;
}

export interface EvidenceExplanationSummary {
  supportingCount: number;
  contradictingCount: number;
  missingCount: number;
  missingItems: string[];
}

export interface MemoryDemoWalkthroughMetric {
  label: string;
  value: string;
}

export interface MemoryDemoWalkthroughStage {
  id: string;
  title: string;
  talkTrack: string;
  evidence: string;
  reference: string;
  metrics: MemoryDemoWalkthroughMetric[];
}

export interface MemoryDemoWalkthrough {
  title: string;
  subject: string;
  summary: string;
  stages: MemoryDemoWalkthroughStage[];
}

export type HomeMemoryLlmSource = 'llm' | 'cache' | 'deterministic-fallback' | 'planned' | 'skipped' | 'none';

export interface HomeMemoryLlmTraceInput {
  hypothesis?: {
    id?: string;
    label?: string;
    llmEnrichmentSource?: HomeMemoryLlmSource;
    llmEnrichment?: HomeMemoryLlmTraceEnrichment;
    llmEnrichmentErrors?: string[];
    llmReliabilityReviewSource?: HomeMemoryLlmSource;
    llmReliabilityReview?: HomeMemoryLlmTraceEnrichment;
    llmReliabilityReviewErrors?: string[];
  } | null;
  portrait?: {
    llmSummarySource?: HomeMemoryLlmSource;
    llmSummary?: HomeMemoryLlmTraceEnrichment;
    llmSummaryErrors?: string[];
  } | null;
  batchPlan?: {
    items?: HomeMemoryLlmTraceBatchInput[];
  } | null;
  metrics?: {
    enabled?: boolean;
    cacheSize?: number;
    rates?: {
      cacheHitRate?: number;
      fallbackRate?: number;
      validationRejectionRate?: number;
      userTriggeredCallRatio?: number;
    };
    budgets?: {
      callsThisHour?: number;
      maxCallsPerHomePerHour?: number;
      callsToday?: number;
      maxCallsPerHomePerDay?: number;
    };
  } | null;
  error?: string | null;
}

type HomeMemoryLlmTraceBudget = NonNullable<NonNullable<HomeMemoryLlmTraceInput['metrics']>['budgets']>;

export interface HomeMemoryLlmTraceEnrichment {
  claim?: string;
  missingEvidence?: string[];
  contradictingEvidenceIds?: string[];
  alternatives?: Array<{
    claim: string;
    confidence: number;
    evidenceIds: string[];
  }>;
}

export interface HomeMemoryLlmTraceBatchInput {
  purpose: string;
  targetId: string;
  shouldCall: boolean;
  reason: string;
  cached?: boolean;
}

export interface HomeMemoryLlmTraceRow {
  label: string;
  source: HomeMemoryLlmSource;
  claim: string;
  missingEvidence: string[];
  contradictingEvidenceIds: string[];
  alternatives: string[];
  errors: string[];
}

export interface HomeMemoryLlmTraceBatchItem {
  purpose: string;
  targetId: string;
  source: HomeMemoryLlmSource;
  reason: string;
}

export interface HomeMemoryLlmTraceMetric {
  label: string;
  value: string;
}

export interface HomeMemoryLlmTrace {
  enabled: boolean;
  cacheSize: number;
  error: string | null;
  metrics: HomeMemoryLlmTraceMetric[];
  rows: HomeMemoryLlmTraceRow[];
  batchItems: HomeMemoryLlmTraceBatchItem[];
}

export function createHomeMemoryLlmTrace(input: HomeMemoryLlmTraceInput): HomeMemoryLlmTrace {
  const rows = [
    createTraceRow('Hypothesis explanation', input.hypothesis?.llmEnrichmentSource, input.hypothesis?.llmEnrichment, input.hypothesis?.llmEnrichmentErrors),
    createTraceRow('Reliability review', input.hypothesis?.llmReliabilityReviewSource, input.hypothesis?.llmReliabilityReview, input.hypothesis?.llmReliabilityReviewErrors),
    createTraceRow('Portrait summary', input.portrait?.llmSummarySource, input.portrait?.llmSummary, input.portrait?.llmSummaryErrors)
  ].filter((row): row is HomeMemoryLlmTraceRow => Boolean(row));

  return {
    enabled: Boolean(input.metrics?.enabled),
    cacheSize: input.metrics?.cacheSize ?? 0,
    error: input.error ?? null,
    metrics: [
      { label: 'Cache hit', value: formatPercent(input.metrics?.rates?.cacheHitRate) },
      { label: 'Fallback', value: formatPercent(input.metrics?.rates?.fallbackRate) },
      { label: 'Validation rejected', value: formatPercent(input.metrics?.rates?.validationRejectionRate) },
      { label: 'Budget', value: formatBudget(input.metrics?.budgets) }
    ],
    rows,
    batchItems: (input.batchPlan?.items ?? []).slice(0, 6).map((item) => ({
      purpose: item.purpose,
      targetId: item.targetId,
      source: item.cached ? 'cache' : item.shouldCall ? 'planned' : 'skipped',
      reason: item.reason
    }))
  };
}

export function createSemanticSignalRows(memory: HomeMemory, limit = 8): SemanticSignalRow[] {
  return [...memory.semanticSignals]
    .sort((left, right) => right.simTime.localeCompare(left.simTime) || right.id.localeCompare(left.id))
    .slice(0, limit)
    .map(toSemanticSignalRow);
}

export function createMemoryDemoWalkthrough(
  memory: HomeMemory,
  hypotheses: ProfileHypothesis[],
  selectedHypothesis: ProfileHypothesis | null,
  locale: MemoryLocale = 'en'
): MemoryDemoWalkthrough {
  const zh = locale === 'zh';
  const hypothesis = selectedHypothesis ?? hypotheses.find((candidate) => candidate.type === 'household_size') ?? hypotheses[0] ?? null;
  const eventFlow = createEventEvidenceFlow(memory, hypotheses, memory.recentEvents[0] ?? null);
  const trace = hypothesis ? createHypothesisWhiteBoxTrace(memory, hypothesis) : null;
  const latestEvent = memory.recentEvents[0] ?? null;
  const eventStep = eventFlow?.steps.find((step) => step.label === 'Device event');
  const semanticStep = eventFlow?.steps.find((step) => step.label === 'Semantic signals');
  const factStep = eventFlow?.steps.find((step) => step.label === 'Fact memory');
  const aggregateStep = eventFlow?.steps.find((step) => step.label === 'Evidence aggregate');
  const scoreLedger = trace ? whiteBoxSection(trace, 'Score ledger') : null;

  return {
    title: zh ? '演示串讲' : 'Presenter walkthrough',
    subject: hypothesis ? localizedHypothesisLabel(hypothesis, locale) : (zh ? '等待画像结论' : 'Waiting for profile hypothesis'),
    summary: zh
      ? '演示时可以按这条链路讲：设备事件进入、证据分类、事实记忆、语义解释、行为片段、画像结论，最后展开白盒计算。'
      : 'Follow these stages during a demo: observed device event, evidence classification, fact memory, semantic meaning, episode compression, profile conclusion, and transparent calculation.',
    stages: [
      {
        id: 'device-event-stream',
        title: zh ? '1. 设备事件流' : '1. Device event stream',
        talkTrack: zh
          ? '先说明 memory 只消费 /ws/device-events：也就是哪个房间、哪个设备、哪个设备字段，在什么模拟时间变成了什么值。'
          : 'Start by saying memory only consumes /ws/device-events: device field value changes with room, device, field, value, run, sequence, and simulation time.',
        evidence: latestEvent ? localizedEventTitle(latestEvent, locale) : (zh ? '还没有设备事件进入。' : 'No device event has arrived yet.'),
        reference: zh ? '输入边界' : 'Input boundary',
        metrics: [
          { label: 'Events', value: String(memory.totalEvents) },
          { label: 'Run', value: memory.runId ?? localizedNone(locale) },
          { label: 'Latest sequence', value: latestEvent ? String(latestEvent.sequence) : localizedNone(locale) }
        ]
      },
      {
        id: 'evidence-classification',
        title: zh ? '2. 证据分类' : '2. Evidence classification',
        talkTrack: zh
          ? '再说明每个设备值会被归类为不同证据强度和画像权重。人类活动、主动设备使用比温湿度这类弱环境上下文更有分量。'
          : 'Then explain that each device value is classified into behavior strength and profile weight. Human activity and active device usage count more than weak environment context.',
        evidence: latestEvent
          ? localizedClassificationEvidence(latestEvent, locale)
          : (zh ? '等待事件分类。' : 'Waiting for an event classification.'),
        reference: 'classifyDeviceEvidence',
        metrics: localizedMetrics(eventStep?.metrics ?? [], locale)
      },
      {
        id: 'fact-memory',
        title: zh ? '3. 事实记忆' : '3. Fact memory',
        talkTrack: zh
          ? '接着说明在产生任何高层结论前，事件会先落到字段、设备、房间和整个家庭的事实记忆里。'
          : 'Next show that the event is stored as fact memory at field, device, room, and home levels before any high-level conclusion is made.',
        evidence: latestEvent
          ? localizedFactMemoryEvidence(memory, latestEvent, locale)
          : (zh ? '还没有事实记忆被更新。' : 'No fact memory row has been updated yet.'),
        reference: zh ? '字段 / 设备 / 房间 / 家庭记忆' : 'Field / Device / Room / Home memory',
        metrics: localizedMetrics(aggregateStep?.metrics ?? [
          { label: 'Rooms', value: String(Object.keys(memory.rooms).length) },
          { label: 'Devices', value: String(Object.keys(memory.devices).length) },
          { label: 'Fields', value: String(Object.keys(memory.fields).length) }
        ], locale)
      },
      {
        id: 'semantic-interpretation',
        title: zh ? '4. 语义解释' : '4. Semantic interpretation',
        talkTrack: zh
          ? '事实存好后，有意义的事件会被翻译成语义信号，比如在家、入口、睡眠、做饭、媒体娱乐、气候控制或环境上下文。'
          : 'After facts are stored, meaningful events are translated into semantic signals such as presence, access, sleep, cooking, media, climate, or environment.',
        evidence: localizedSemanticEvidence(memory, latestEvent, semanticStep?.detail, locale),
        reference: zh ? '语义信号' : 'Semantic signals',
        metrics: [
          { label: 'Semantic signals', value: String(memory.semanticSignalCount) },
          { label: 'Recent semantic types', value: recentSignalTypes(memory, locale) }
        ]
      },
      {
        id: 'episodes-and-summaries',
        title: zh ? '5. 行为片段与摘要' : '5. Episodes and summaries',
        talkTrack: zh
          ? '然后说明高频设备事件会被压缩成行为片段，日摘要和周摘要则保留更长窗口里的活动范围。'
          : 'Then explain that high-frequency device events are compressed into behavior episodes, while daily and weekly summaries preserve longer-window activity.',
        evidence: zh
          ? '行为片段用于降低传感器重复上报的噪声；日/周摘要保留长窗口中的房间、设备、字段、时间段和有意义活动。'
          : 'Episodes reduce repeated sensor noise; daily and weekly summaries keep long-window rooms, devices, fields, time buckets, and meaningful activity.',
        reference: zh ? '行为片段和日/周摘要' : 'Episodes and daily/weekly summaries',
        metrics: [
          { label: 'Episodes', value: String(memory.episodeCount) },
          { label: 'Activity episodes', value: String(memory.activityEpisodeCount) },
          { label: 'Days', value: String(memory.dailySummaryCount) },
          { label: 'Weeks', value: String(memory.weeklySummaryCount) }
        ]
      },
      {
        id: 'profile-hypothesis',
        title: zh ? '6. 画像结论' : '6. Profile hypothesis',
        talkTrack: hypothesis
          ? (zh
              ? `现在讲当前选中的结论「${localizedHypothesisLabel(hypothesis, locale)}」：它是概率画像，不是系统真值。`
              : `Now present the selected conclusion, "${hypothesis.label}", as a probabilistic profile hypothesis rather than ground truth.`)
          : (zh ? '当证据足够时，memory 会生成概率式画像结论。' : 'Once enough evidence arrives, memory creates probabilistic profile hypotheses.'),
        evidence: hypothesis ? localizedHypothesisEvidence(hypothesis, locale) : (zh ? '还没有推断出画像结论。' : 'No profile hypothesis has been inferred yet.'),
        reference: zh ? '画像结论' : 'Profile hypotheses',
        metrics: hypothesis
          ? [
              { label: 'Type', value: localizedHypothesisType(hypothesis.type, locale) },
              { label: 'Confidence', value: `${Math.round(hypothesis.confidence * 100)}%` },
              { label: 'Evidence rows', value: String(hypothesis.evidence.length) }
            ]
          : []
      },
      {
        id: 'white-box-calculation',
        title: zh ? '7. 白盒计算' : '7. White-box calculation',
        talkTrack: zh
          ? '最后展开白盒区域：直接证据、语义解释、聚合特征、候选评分、评分账本、置信度和缺失证据。'
          : 'Finish by opening the white-box sections: direct evidence, semantic interpretation, aggregate features, candidate scoring, score ledger, confidence, and missing evidence.',
        evidence: trace
          ? trace.sections.map((section) => localizedTraceSectionTitle(section.title, locale)).join(' -> ')
          : (zh ? '还没有可展示的白盒链路。' : 'No white-box trace is available yet.'),
        reference: zh ? '白盒链路和完整账本' : 'White-box trace and complete ledger',
        metrics: trace
          ? [
              { label: 'Trace sections', value: String(trace.sections.length) },
              { label: 'Score ledger rows', value: String(scoreLedger?.rows.length ?? 0) }
            ]
          : []
      }
    ]
  };
}

export function createEvidenceExplanationSummary(hypothesis: ProfileHypothesis): EvidenceExplanationSummary {
  return {
    supportingCount: hypothesis.supportingEvidence.length,
    contradictingCount: hypothesis.contradictingEvidence.length,
    missingCount: hypothesis.missingEvidence.length,
    missingItems: hypothesis.missingEvidence
  };
}

function toSemanticSignalRow(signal: SemanticSignal): SemanticSignalRow {
  return {
    id: signal.id,
    typeLabel: signal.type.replaceAll('_', ' '),
    location: signal.roomId,
    source: `${signal.deviceId}.${signal.field}`,
    value: formatValue(signal.value),
    strength: signal.strength,
    weight: Number(signal.profileWeight.toFixed(2)).toString(),
    time: signal.simTime,
    reason: signal.reason
  };
}

function whiteBoxSection(trace: HypothesisWhiteBoxTrace, title: string): HypothesisWhiteBoxTrace['sections'][number] | null {
  return trace.sections.find((section) => section.title === title) ?? null;
}

function localizedEventTitle(event: HomeMemory['recentEvents'][number], locale: MemoryLocale): string {
  if (locale === 'zh') {
    return `${event.roomId} 的 ${event.deviceId}.${event.field} 变为 ${formatValue(event.value)}`;
  }
  return `${event.deviceId}.${event.field} changed to ${formatValue(event.value)}`;
}

function localizedClassificationEvidence(event: HomeMemory['recentEvents'][number], locale: MemoryLocale): string {
  if (locale === 'zh') {
    return `系统将 ${event.deviceId}.${event.field} 归为${localizedEvidenceCategory(event.evidenceCategory, locale)}，强度为${localizedStrength(event.evidenceStrength, locale)}，画像权重 ${formatWeight(event.profileWeight)}。`;
  }
  return `${event.deviceId}.${event.field} is ${event.evidenceCategory.replaceAll('_', ' ')} evidence with ${event.evidenceStrength} strength and ${formatWeight(event.profileWeight)} profile weight.`;
}

function localizedFactMemoryEvidence(memory: HomeMemory, event: HomeMemory['recentEvents'][number], locale: MemoryLocale): string {
  const fieldId = `${event.deviceId}:${event.field}`;
  const currentValue = memory.fields[fieldId]?.currentValue ?? event.value;
  if (locale === 'zh') {
    return `${event.roomId} / ${event.deviceId} / ${event.field} 当前保存为 ${formatValue(currentValue)}，并同步更新字段、设备、房间和家庭计数。`;
  }
  return `${event.roomId} / ${event.deviceId} / ${event.field} now stores ${formatValue(currentValue)} and updates field, device, room, and home counters.`;
}

function localizedSemanticEvidence(memory: HomeMemory, event: HomeMemory['recentEvents'][number] | null, fallback: string | undefined, locale: MemoryLocale): string {
  if (!event) {
    return locale === 'zh' ? '最新事件还没有产生语义信号。' : (fallback ?? 'No semantic signal was derived from the latest event.');
  }
  const signals = memory.semanticSignals.filter((signal) => signal.sourceEvidenceIds.includes(event.id));
  if (signals.length === 0) {
    return locale === 'zh' ? '最新事件没有产生语义信号，因此只保留为事实记忆。' : (fallback ?? 'No semantic signal was derived from the latest event.');
  }
  const types = formatSignalTypes(signals.map((signal) => signal.type), locale);
  return locale === 'zh'
    ? `最新事件产生 ${signals.length} 条语义信号：${types}。`
    : `${signals.length} semantic signal${signals.length === 1 ? '' : 's'} derived from this event: ${types}.`;
}

function localizedHypothesisEvidence(hypothesis: ProfileHypothesis, locale: MemoryLocale): string {
  if (locale === 'zh') {
    return `当前结论是「${localizedHypothesisLabel(hypothesis, locale)}」，类型为${localizedHypothesisType(hypothesis.type, locale)}，置信度 ${Math.round(hypothesis.confidence * 100)}%，引用 ${hypothesis.evidence.length} 条直接证据。`;
  }
  return hypothesis.summary;
}

function localizedHypothesisLabel(hypothesis: ProfileHypothesis, locale: MemoryLocale): string {
  if (locale !== 'zh') {
    return hypothesis.label;
  }
  if (hypothesis.type === 'household_size') return '可能的家庭人数';
  if (hypothesis.type === 'presence_signal') return '最近在家活动信号';
  return hypothesis.label;
}

function localizedMetrics(metrics: MemoryDemoWalkthroughMetric[], locale: MemoryLocale): MemoryDemoWalkthroughMetric[] {
  if (locale !== 'zh') {
    return metrics;
  }
  return metrics.map((metric) => ({
    label: metric.label,
    value: localizedMetricValue(metric.value, locale)
  }));
}

function localizedMetricValue(value: string, locale: MemoryLocale): string {
  if (locale !== 'zh') {
    return value;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'none') return '无';
  if (normalized === 'human activity') return '人类活动';
  if (normalized === 'device usage') return '设备使用';
  if (normalized === 'environment context') return '环境上下文';
  if (normalized === 'system status') return '系统状态';
  if (normalized === 'strong') return '强';
  if (normalized === 'medium') return '中';
  if (normalized === 'weak') return '弱';
  if (normalized === 'ignored') return '忽略';
  if (normalized === 'meaningful') return '有意义变化';
  if (normalized === 'telemetry') return '遥测';
  return value;
}

function localizedEvidenceCategory(category: HomeMemory['recentEvents'][number]['evidenceCategory'], locale: MemoryLocale): string {
  if (locale !== 'zh') {
    return category.replaceAll('_', ' ');
  }
  if (category === 'human_activity') return '人类活动证据';
  if (category === 'device_usage') return '设备使用证据';
  if (category === 'environment_context') return '环境上下文';
  return '系统状态';
}

function localizedStrength(strength: HomeMemory['recentEvents'][number]['evidenceStrength'], locale: MemoryLocale): string {
  if (locale !== 'zh') {
    return strength;
  }
  if (strength === 'strong') return '强';
  if (strength === 'medium') return '中';
  if (strength === 'weak') return '弱';
  return '忽略';
}

function recentSignalTypes(memory: HomeMemory, locale: MemoryLocale): string {
  const types = [...new Set(memory.semanticSignals.slice(0, 8).map((signal) => signal.type))];
  return types.length > 0 ? formatSignalTypes(types, locale) : localizedNone(locale);
}

function formatSignalTypes(types: string[], locale: MemoryLocale): string {
  return [...new Set(types.map((type) => localizedSignalType(type, locale)))]
    .sort((left, right) => left.localeCompare(right))
    .join(', ');
}

function localizedSignalType(type: string, locale: MemoryLocale): string {
  if (locale !== 'zh') {
    return type.replaceAll('_', ' ');
  }
  const labels: Record<string, string> = {
    presence_signal: '在家/活动信号',
    access_signal: '入口信号',
    sleep_signal: '睡眠信号',
    water_signal: '用水信号',
    cooking_signal: '做饭信号',
    media_signal: '媒体娱乐信号',
    work_study_signal: '工作/学习信号',
    lighting_signal: '照明信号',
    climate_signal: '气候控制信号',
    environment_signal: '环境信号',
    system_signal: '系统信号'
  };
  return labels[type] ?? type.replaceAll('_', ' ');
}

function localizedTraceSectionTitle(title: string, locale: MemoryLocale): string {
  if (locale !== 'zh') {
    return title;
  }
  const labels: Record<string, string> = {
    'Observed conclusion': '观察结论',
    'Direct evidence': '直接证据',
    'Semantic interpretation': '语义解释',
    'Aggregate features': '聚合特征',
    'Rule inputs': '规则输入',
    'Candidate scoring': '候选评分',
    'Score ledger': '评分账本',
    'Confidence calculation': '置信度计算',
    'Missing or weak evidence': '缺失或弱证据'
  };
  return labels[title] ?? title;
}

function localizedHypothesisType(type: ProfileHypothesis['type'], locale: MemoryLocale): string {
  if (locale !== 'zh') {
    return type.replaceAll('_', ' ');
  }
  const labels: Record<ProfileHypothesis['type'], string> = {
    household_size: '家庭人数',
    daily_rhythm: '日常节律',
    room_habit: '房间习惯',
    device_routine: '设备例程',
    presence_signal: '在家信号',
    activity_cluster: '活动聚类',
    routine_window: '例程时间窗',
    behavior_flow: '行为流程',
    resident_slot: '住户槽位',
    room_function: '房间功能',
    device_contribution: '设备贡献',
    household_composition: '家庭组成',
    automation_recommendation: '自动化建议',
    state_anomaly: '状态异常'
  };
  return labels[type];
}

function localizedNone(locale: MemoryLocale): string {
  return locale === 'zh' ? '无' : 'none';
}

function formatWeight(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatValue(value: DeviceEventValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function createTraceRow(
  label: string,
  source: HomeMemoryLlmSource | undefined,
  enrichment: HomeMemoryLlmTraceEnrichment | undefined,
  errors: string[] | undefined
): HomeMemoryLlmTraceRow | null {
  if (!source && !enrichment && (!errors || errors.length === 0)) {
    return null;
  }
  return {
    label,
    source: source ?? 'none',
    claim: enrichment?.claim ?? 'No LLM enrichment returned.',
    missingEvidence: enrichment?.missingEvidence ?? [],
    contradictingEvidenceIds: enrichment?.contradictingEvidenceIds ?? [],
    alternatives: (enrichment?.alternatives ?? []).map((alternative) => (
      `${alternative.claim} (${Math.round(alternative.confidence * 100)}%)`
    )),
    errors: errors ?? []
  };
}

function formatPercent(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function formatBudget(budget: HomeMemoryLlmTraceBudget | undefined): string {
  const callsThisHour = budget?.callsThisHour ?? 0;
  const maxCallsPerHomePerHour = budget?.maxCallsPerHomePerHour ?? 0;
  const callsToday = budget?.callsToday ?? 0;
  const maxCallsPerHomePerDay = budget?.maxCallsPerHomePerDay ?? 0;
  return `${callsThisHour}/${maxCallsPerHomePerHour} hour, ${callsToday}/${maxCallsPerHomePerDay} day`;
}
