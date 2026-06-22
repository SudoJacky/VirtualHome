import { getCatalog } from '../sim/catalog';
import { createExternalContext } from '../sim/externalContext';
import { summarizeAgentMemory } from '../sim/agents/memory';
import { commitmentPressureAtMinute, createDailyCommitments, type DailyCommitment } from '../sim/agents/scheduler';
import { getPersona } from '../sim/personas/defaultFamily';
import { createDeviceCommandTimeline, type DeviceCommandTimelineEntry } from '../shared/deviceCommandLifecycle';
import { evaluateDeviceHealthSignals, getDeviceCapability, isDeviceTypeAbnormal, isDeviceTypeActive, summarizeDeviceState, type DeviceCommandFailureReason, type DeviceCommandValueType, type DeviceHealthImpact, type DeviceHealthSignalKind } from '../shared/deviceRegistry';
import { getDeviceCommandMetadataForInstance, getDeviceSupportedCommands } from '../shared/deviceInstanceCapabilities';
import { inferTwinState } from '../twin/inferenceModel';
import type { AlertLifecycleStatus, AlertState, DeviceState, EventExplanation, RoomId, TwinEvent, TwinSnapshot } from '../shared/types';

export interface DashboardEvent {
  id: string;
  time: string;
  type: string;
  label: string;
}

export interface DashboardModel {
  homeMode: string;
  simTime: string;
  occupancyCount: number;
  occupiedRooms: string[];
  activeDeviceCount: number;
  alerts: AlertState[];
  alertStatusSummary: AlertStatusSummary;
  homeBriefing: HomeBriefing;
  householdActivity: HouseholdActivity;
  controlRecords: ControlRecord[];
  controlRecordFilters: ControlRecordFilters;
  deviceControlCards: DeviceControlCard[];
  automationExplanations: AutomationExplanation[];
  alertWorkflows: AlertWorkflow[];
  scenarioCards: ScenarioCard[];
  demoSpotlight: DemoSpotlight | null;
  recentEvents: DashboardEvent[];
  deviceHealthCards: DeviceHealthCard[];
  behaviorCards: BehaviorCard[];
  deviceLifecycleCards: DeviceLifecycleCard[];
  causalEvents: CausalEventCard[];
  behaviorAudit: BehaviorAudit;
  predictionCards: PredictionCard[];
  twinInference: TwinInferencePanel;
  forecastTelemetrySeries: ForecastTelemetrySeries[];
  forecastCharts: ForecastChart[];
  insightCards: InsightCard[];
  telemetrySeries: Array<{
    id: string;
    label: string;
    points: number[];
    currentValue: number;
    unit: string;
    normalRange: [number, number];
    thresholdStatus: 'normal' | 'watch' | 'alert';
    insight: string;
    relatedAutomation: string | null;
  }>;
  floorplanRooms: Record<RoomId, {
    people: Array<{
      id: string;
      label: string;
      activity: string;
      slot: number;
      recent: boolean;
    }>;
    devices: Array<{
      id: string;
      label: string;
      summary: string;
      active: boolean;
      slot: number;
    }>;
    activeDeviceCount: number;
  }>;
}

export interface TwinInferencePanel {
  inputSummary: {
    observationOnly: true;
    acceptedEventCount: number;
    rejectedEventTypes: string[];
  };
  homeMode: {
    truth: string;
    inferred: string;
    confidence: number;
    probabilities: Record<string, number>;
  };
  people: Array<{
    personId: string;
    label: string;
    truthRoom: string;
    inferredRoom: string;
    roomConfidence: number;
    truthActivity: string;
    inferredActivity: string;
    activityConfidence: number;
  }>;
  risks: Array<{
    id: string;
    probability: number;
    drivers: string[];
  }>;
  forecasts: Array<{
    horizonMinutes: number;
    inferredHomeMode: string;
    risks: Record<string, number>;
  }>;
}

export interface HouseholdActivity {
  title: string;
  summary: string;
  roomName: string;
  participants: string[];
  nextAction: string;
}

export interface AlertStatusSummary {
  new: number;
  acknowledged: number;
  unresolved: number;
  resolved: number;
  ignored: number;
}

export interface PriorityItem {
  id: string;
  kind: 'alert' | 'automation' | 'device_health' | 'comfort' | 'activity';
  priority: number;
  headline: string;
  summary: string;
  roomId: RoomId;
  roomName: string;
  action: string;
  sourceId?: string;
}

export interface HomeBriefing {
  status: 'Good' | 'Watch' | 'Needs attention';
  summary: string;
  primaryItem: PriorityItem | null;
  highlights: string[];
  nextAction: string;
}

export interface ControlRecord {
  id: string;
  time: string;
  scenarioId: string;
  deviceId: string;
  deviceName: string;
  roomName: string;
  people: string[];
  alertSeverity: AlertState['severity'] | null;
  actor: string;
  trigger: string;
  ruleName: string;
  action: string;
  previousState: string;
  nextState: string;
  payload: Record<string, string | string[] | null>;
  reason: string;
}

export interface ControlRecordFilters {
  rooms: string[];
  rules: string[];
  devices: string[];
  people: string[];
  scenarios: string[];
  alertSeverities: AlertState['severity'][];
  timeRange: { from: string; to: string } | null;
}

export interface AutomationExplanation {
  id: string;
  time: string;
  ruleId: string;
  ruleName: string;
  explanation: string;
  matchedFacts: string[];
  actions: string[];
  decisionChain: Array<{
    label: string;
    value: string;
  }>;
}

export interface AlertWorkflow {
  alertId: string;
  title: string;
  roomName: string;
  severity: AlertState['severity'];
  lifecycleStatus: AlertLifecycleStatus;
  status: string;
  recommendedAction: string;
  evidence: string[];
  actions: AlertWorkflowAction[];
  steps: string[];
}

export interface AlertWorkflowAction {
  kind: 'acknowledge' | 'remind' | 'ignore' | 'evidence' | 'replay' | 'resolve';
  label: string;
  endpoint?: string;
  status?: AlertLifecycleStatus;
  highRisk: boolean;
}

export interface DeviceControlCard {
  deviceId: string;
  displayName: string;
  roomName: string;
  deviceType: string;
  statusLabel: string;
  connectivity: 'online' | 'offline';
  disabledReason: string | null;
  commandStatus: 'none' | 'requested' | 'sent' | 'acknowledged' | 'failed';
  commandTimeline: DeviceCommandTimelineEntry[];
  lastEventAt: string | null;
  recentEvents: DeviceRecentEvent[];
  controls: DeviceCommandControl[];
}

export interface DeviceRecentEvent {
  id: string;
  type: 'DeviceStateChanged' | 'DeviceTelemetry';
  time: string;
  sequence: number;
  label: string;
  reason: string | null;
}

export interface DeviceCommandControl {
  command: string;
  label: string;
  controlType: 'button' | 'toggle' | 'slider' | 'select';
  field: string | null;
  value: string | number | boolean | null;
  min?: number;
  max?: number;
  options?: string[];
  disabled: boolean;
  disabledReason: string | null;
  highRisk: boolean;
  requiresConfirmation: boolean;
  valueType: DeviceCommandValueType;
  failureReasons: DeviceCommandFailureReason[];
}

export interface DeviceHealthCard {
  id: string;
  deviceId: string;
  displayName: string;
  roomName: string;
  signal: string;
  kind: DeviceHealthSignalKind;
  status: 'watch' | 'alert';
  priority: number;
  sourceField: string | null;
  reportedValue: string | number | boolean | null;
  recommendedAction: string;
  expectedEffect: string;
  impact: DeviceHealthImpact;
  maintenanceAction: 'restart' | 'replace_or_recharge' | 'calibrate' | 'inspect' | 'monitor';
  maintenanceLabel: string;
  focusDeviceId: string;
}

export interface BehaviorCard {
  personId: string;
  label: string;
  roomId: RoomId | 'away';
  roomName: string;
  activity: string;
  routinePhase: string;
  intent: string;
  attentionTarget: string;
  energy: number;
  priority: number;
}

export interface DeviceLifecycleCard {
  deviceId: string;
  displayName: string;
  roomName: string;
  status: string;
  headline: string;
  nextAction: string;
  priority: number;
  relatedAlertId: string | null;
}

export interface CausalEventCard {
  eventId: string;
  time: string;
  type: string;
  ruleId: string | null;
  why: string;
  actors: string[];
  affectedDevices: string[];
  affectedRooms: string[];
  relatedIntent: string | null;
  expectedOutcome: string;
  actions: string[];
  priority: number;
}

export interface BehaviorAudit {
  people: BehaviorAuditPerson[];
  deviceLifecycles: DeviceLifecycleCard[];
  recentCausalEvents: CausalEventCard[];
  unresolvedTasks: BehaviorAuditTask[];
  consistencyWarnings: string[];
}

export interface BehaviorAuditPerson {
  personId: string;
  label: string;
  location: string;
  activity: string;
  intent: string;
  routinePhase: string;
  energy: number;
  attentionTarget: string;
  nextPlan: string;
  memorySummary: string;
  nextCommitment: BehaviorAuditCommitment | null;
  triggeredRules: string[];
  affectedByDevices: string[];
  affectsDevices: string[];
}

export interface BehaviorAuditCommitment {
  activity: string;
  roomName: string;
  window: string;
  pressure: number;
  source: DailyCommitment['source'];
}

export interface BehaviorAuditTask {
  id: string;
  label: string;
  owner: string;
  source: string;
  status: string;
}

export interface InsightCard {
  id: string;
  category: 'energy' | 'water' | 'health_comfort' | 'device_health';
  priority: number;
  title: string;
  reason: string;
  recommendedAction: string;
  expectedEffect: string;
  roomName: string;
  relatedDeviceId: string;
  status: 'normal' | 'watch' | 'alert';
}

export interface PredictionCard {
  id: string;
  alertId: string;
  horizon: '15 min';
  title: string;
  forecast: string;
  ifIgnored: string;
  ifHandledNow: string;
  impact: DeviceHealthImpact;
  roomName: string;
  relatedDeviceId: string;
  forecastPoints: ForecastPoint[];
  forecastModel: ForecastModelDetail;
  chart: ForecastChart;
  recoveryEstimate: PredictionRecoveryEstimate;
  priority: number;
}

export interface ForecastModelDetail {
  kind: string;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  roomVolumeM3: number | null;
  currentPowerW: number | null;
  openMinutes: number | null;
  currentTemperatureC: number | null;
}

export interface ForecastPoint {
  metric: string;
  unit: string;
  ignored: number[];
  handledNow: number[];
  confidenceInterval: ForecastConfidenceInterval;
}

export interface ForecastConfidenceInterval {
  levelPercent: number;
  spreadPercent: number;
  ignoredLow: number[];
  ignoredHigh: number[];
  handledNowLow: number[];
  handledNowHigh: number[];
}

export interface PredictionRecoveryEstimate {
  operatorId: string;
  action: string;
  estimatedRecoveryMinutes: number;
  impactReductionPercent: number;
  confidence: 'low' | 'medium' | 'high';
  basis: string;
}

export interface ForecastTelemetrySeries {
  id: string;
  alertId: string;
  metric: string;
  unit: string;
  horizonMinutes: number[];
  ignored: number[];
  handledNow: number[];
  confidenceInterval: ForecastConfidenceInterval;
}

export interface ForecastChart {
  id: string;
  title: string;
  alertId: string;
  horizonMinutes: number[];
  yAxisLabel: string;
  series: ForecastChartSeries[];
}

export interface ForecastChartSeries {
  metric: string;
  label: string;
  unit: string;
  ignored: number[];
  handledNow: number[];
  confidenceInterval: ForecastConfidenceInterval;
}

export interface ScenarioCard {
  id: string;
  title: string;
  businessValue: string;
  expectedTimeline: string;
  expectedDeviceActions: string[];
  expectedAlerts: string[];
  recordsGenerated: string;
}

export interface DemoSpotlight {
  id: string;
  scenarioId: string;
  kind: 'automation' | 'alert' | 'activity';
  headline: string;
  summary: string;
  roomId: RoomId;
  roomName: string;
  pauseMs: number;
  automationId?: string;
  controlRecordId?: string;
  focusDeviceId?: string;
  replayRuleId?: string;
}

const catalog = getCatalog();
const roomsById = new Map(catalog.rooms.map((room) => [room.id, room]));
const devicesById = new Map(catalog.devices.map((device) => [device.id, device]));

const personLabels: Record<string, string> = {
  adult_1: 'Commuter adult',
  adult_2: 'Hybrid work adult',
  child_1: 'Student',
  senior_1: 'Senior family member',
  pet_1: 'Pet'
};
const humanMemberLabels = catalog.people
  .filter((person) => person.kind === 'human' && person.homeMember)
  .map((person) => formatPerson(person.id));

const scenarioCards: ScenarioCard[] = [
  {
    id: 'weekday_normal',
    title: 'Normal weekday',
    businessValue: 'Demonstrates a realistic family day producing routine device records.',
    expectedTimeline: 'Wake up, breakfast, commute, remote work, dinner, evening TV, sleep.',
    expectedDeviceActions: ['Lights respond to occupancy', 'Door lock follows departures', 'Kitchen devices follow meals'],
    expectedAlerts: ['None expected'],
    recordsGenerated: 'Routine lighting, appliance, door lock, sleep, and activity records.'
  },
  {
    id: 'away_day',
    title: 'Away day',
    businessValue: 'Shows security arming and unattended-device protection when everyone leaves.',
    expectedTimeline: 'Family prepares to leave, last person exits, security mode arms.',
    expectedDeviceActions: ['Door lock secures home', 'Stove safety rule turns off unattended power', 'Shared devices power down'],
    expectedAlerts: ['Stove unattended warning if kitchen is empty'],
    recordsGenerated: 'Departure, lock, safety automation, and away-mode records.'
  },
  {
    id: 'night_water_leak',
    title: 'Night water leak',
    businessValue: 'Demonstrates safety automation and alert response while the household sleeps.',
    expectedTimeline: 'Leak sensor activates, alert is raised, valve closes, homeowner notification is prepared.',
    expectedDeviceActions: ['Main water valve closes', 'Water flow telemetry changes', 'Alert response is recorded'],
    expectedAlerts: ['Bathroom leak detected while home is sleeping'],
    recordsGenerated: 'Leak alert, valve command, rule explanation, and response workflow records.'
  },
  {
    id: 'fridge_left_open',
    title: 'Fridge door left open',
    businessValue: 'Shows appliance anomaly detection and recommended homeowner action.',
    expectedTimeline: 'Door opens, alert appears, an adult goes to the kitchen, closes it, and recovery is recorded.',
    expectedDeviceActions: ['Fridge closes after an operator approaches the kitchen'],
    expectedAlerts: ['Fridge door has remained open, then resolves after closure'],
    recordsGenerated: 'Injection, appliance alert, operator movement, close command, and recovery records.'
  },
  {
    id: 'door_left_open',
    title: 'Door opened while armed',
    businessValue: 'Shows entrance security monitoring and response guidance.',
    expectedTimeline: 'Door-open injection creates entrance warning.',
    expectedDeviceActions: ['Door lock and entrance room become the focus'],
    expectedAlerts: ['Front door has remained open'],
    recordsGenerated: 'Manual injection and entrance security records.'
  },
  {
    id: 'senior_no_activity',
    title: 'Senior no activity',
    businessValue: 'Shows wellness-oriented monitoring without exposing private details.',
    expectedTimeline: 'No-activity injection creates a check-in workflow.',
    expectedDeviceActions: ['Sleep and room state remain inspectable'],
    expectedAlerts: ['Senior has no morning activity yet'],
    recordsGenerated: 'Wellness alert and recommended check-in records.'
  },
  {
    id: 'network_offline',
    title: 'Network outage',
    businessValue: 'Shows operational resilience and degraded-state reporting.',
    expectedTimeline: 'Router goes offline, remote work is affected, adult_2 restarts it, and network recovery is recorded.',
    expectedDeviceActions: ['Hybrid worker approaches the router and restarts it'],
    expectedAlerts: ['Home network is offline, then resolves after restart'],
    recordsGenerated: 'Connectivity alert, operator movement, restart command, and recovery records.'
  },
  {
    id: 'kitchen_air_quality',
    title: 'Kitchen air quality',
    businessValue: 'Shows telemetry thresholds driving ventilation decisions.',
    expectedTimeline: 'Cooking raises PM2.5 and CO2, range hood automation responds.',
    expectedDeviceActions: ['Range hood turns on', 'Kitchen light supports cooking', 'Air-quality telemetry trends down'],
    expectedAlerts: ['No alert expected unless thresholds remain high'],
    recordsGenerated: 'Telemetry, cooking ventilation, and device command records.'
  }
];

export function createDashboardModel(snapshot: TwinSnapshot, events: TwinEvent[]): DashboardModel {
  const occupiedRooms = Object.values(snapshot.rooms)
    .filter((room) => room.occupancy)
    .map((room) => room.name);
  const activeDeviceCount = Object.values(snapshot.devices)
    .filter((device) => isDeviceTypeActive(device.type, device.state))
    .length;
  const controlRecords = createControlRecords(events);
  const automationExplanations = createAutomationExplanations(events, controlRecords);
  const alertWorkflows = createAlertWorkflows(snapshot, events);
  const telemetrySeries = createTelemetrySeries(events);
  const deviceHealthCards = createDeviceHealthCards(snapshot, events);
  const behaviorCards = createBehaviorCards(snapshot);
  const deviceLifecycleCards = createDeviceLifecycleCards(snapshot);
  const causalEvents = createCausalEvents(snapshot, events);
  const behaviorAudit = createBehaviorAudit(snapshot, events, behaviorCards, deviceLifecycleCards, causalEvents);
  const priorityQueue = createPriorityQueue(snapshot, controlRecords, automationExplanations, telemetrySeries, deviceHealthCards);
  const alertStatusSummary = createAlertStatusSummary(snapshot);
  const predictionCards = createPredictionCards(snapshot);
  const twinInference = createTwinInferencePanel(snapshot, events);
  return {
    homeMode: snapshot.homeState.mode,
    simTime: snapshot.simClock.currentTime,
    occupancyCount: snapshot.homeState.occupancyCount,
    occupiedRooms,
    activeDeviceCount,
    alerts: activeAlerts(snapshot).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    alertStatusSummary,
    homeBriefing: createHomeBriefing(snapshot, alertStatusSummary, priorityQueue, automationExplanations),
    householdActivity: createHouseholdActivity(snapshot),
    controlRecords,
    controlRecordFilters: createControlRecordFilters(controlRecords),
    deviceControlCards: createDeviceControlCards(snapshot, events),
    automationExplanations,
    alertWorkflows,
    scenarioCards,
    demoSpotlight: createDemoSpotlight(snapshot, controlRecords, automationExplanations, alertWorkflows, priorityQueue),
    recentEvents: events
      .filter((event) => event.type !== 'DeviceTelemetry')
      .slice(-20)
      .reverse()
      .map(formatEvent),
    deviceHealthCards,
    behaviorCards,
    deviceLifecycleCards,
    causalEvents,
    behaviorAudit,
    predictionCards,
    twinInference,
    forecastTelemetrySeries: createForecastTelemetrySeries(predictionCards),
    forecastCharts: predictionCards.map((card) => card.chart),
    insightCards: createInsightCards(snapshot, telemetrySeries, deviceHealthCards),
    telemetrySeries,
    floorplanRooms: createFloorplanRooms(snapshot, events)
  };
}

function createTwinInferencePanel(snapshot: TwinSnapshot, events: TwinEvent[]): TwinInferencePanel {
  const peopleIds = Object.values(snapshot.people)
    .filter((person) => person.kind === 'human')
    .map((person) => person.id);
  const roomIds = Object.keys(snapshot.rooms) as RoomId[];
  const inference = inferTwinState(events, {
    currentTime: snapshot.simClock.currentTime,
    peopleIds,
    rooms: roomIds,
    externalContext: createExternalContext({
      date: snapshot.simClock.currentTime.slice(0, 10),
      seed: snapshot.runContext.seed
    })
  });

  return {
    inputSummary: inference.inputSummary,
    homeMode: {
      truth: snapshot.homeState.mode,
      inferred: formatBehaviorText(inference.homeMode.top),
      confidence: roundPercent(inference.homeMode.confidence),
      probabilities: roundDistribution(inference.homeMode.probabilities)
    },
    people: peopleIds.map((personId) => {
      const truth = snapshot.people[personId];
      const inferred = inference.people[personId];
      return {
        personId,
        label: formatPerson(personId),
        truthRoom: formatRoomName(truth?.location ?? 'away'),
        inferredRoom: inferred ? formatRoomName(inferred.room.top) : 'Unknown',
        roomConfidence: inferred ? roundPercent(inferred.room.confidence) : 0,
        truthActivity: formatActivity(truth?.activity ?? 'unknown'),
        inferredActivity: inferred ? formatActivity(inferred.activity.top) : 'Unknown',
        activityConfidence: inferred ? roundPercent(inferred.activity.confidence) : 0
      };
    }),
    risks: Object.entries(inference.risks)
      .map(([id, risk]) => ({
        id,
        probability: roundPercent(risk.probability),
        drivers: [...risk.drivers]
      }))
      .sort((left, right) => right.probability - left.probability || left.id.localeCompare(right.id)),
    forecasts: inference.forecasts.map((forecast) => ({
      horizonMinutes: forecast.horizonMinutes,
      inferredHomeMode: formatBehaviorText(forecast.homeMode.top),
      risks: roundDistribution(forecast.risks)
    }))
  };
}

export function mergeTwinEvents(current: TwinEvent[], incoming: TwinEvent[], limit = 100): TwinEvent[] {
  const activeRunId = latestRunId(incoming) ?? latestRunId(current);
  const currentForRun = activeRunId ? current.filter((event) => event.runId === activeRunId) : current;
  const incomingForRun = activeRunId ? incoming.filter((event) => event.runId === activeRunId) : incoming;
  const byId = new Map<string, TwinEvent>();
  for (const event of [...currentForRun, ...incomingForRun]) {
    byId.set(event.id, event);
  }
  return [...byId.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-limit);
}

function latestRunId(events: TwinEvent[]): string | undefined {
  return events.at(-1)?.runId ?? events[0]?.runId;
}

function createAlertStatusSummary(snapshot: TwinSnapshot): AlertStatusSummary {
  const alerts = Object.values(snapshot.alerts);
  const summary: AlertStatusSummary = { new: 0, acknowledged: 0, unresolved: 0, resolved: 0, ignored: 0 };
  for (const alert of alerts) {
    const status = getAlertLifecycleStatus(alert);
    if (status === 'active') summary.new += 1;
    if (status === 'acknowledged') summary.acknowledged += 1;
    if (status === 'resolved') summary.resolved += 1;
    if (status === 'ignored') summary.ignored += 1;
    if (isUnresolvedAlert(alert)) summary.unresolved += 1;
  }
  return summary;
}

function createPriorityQueue(
  snapshot: TwinSnapshot,
  controlRecords: ControlRecord[],
  automationExplanations: AutomationExplanation[],
  telemetrySeries: DashboardModel['telemetrySeries'],
  deviceHealthCards: DeviceHealthCard[]
): PriorityItem[] {
  const alertItems = activeAlerts(snapshot).map((alert) => ({
    id: `alert:${alert.id}`,
    kind: 'alert' as const,
    priority: alertPriority(alert),
    headline: alert.message,
    summary: `${formatRoomName(alert.roomId)} needs review: ${formatAction(alert.recommendedAction)}.`,
    roomId: alert.roomId,
    roomName: formatRoomName(alert.roomId),
    action: `Confirm ${formatAction(alert.recommendedAction)}`,
    sourceId: alert.id
  }));
  const automationItems = automationExplanations.slice(0, 3).map((automation, index) => {
    const record = controlRecords.find((candidate) => candidate.reason === `rule:${automation.ruleId}`);
    const roomId = record ? devicesById.get(record.deviceId)?.roomId ?? inferAutomationRoom(automation.ruleId) ?? firstOccupiedRoom(snapshot) : inferAutomationRoom(automation.ruleId) ?? firstOccupiedRoom(snapshot);
    return {
      id: `automation:${automation.id}`,
      kind: 'automation' as const,
      priority: 38 - index,
      headline: automation.ruleName,
      summary: automation.explanation,
      roomId,
      roomName: formatRoomName(roomId),
      action: automation.actions[0] ? `Review ${automation.actions[0]}` : 'Review automation result',
      sourceId: automation.id
    };
  });
  const telemetryItems = telemetrySeries
    .filter((series) => series.thresholdStatus !== 'normal')
    .map((series) => {
      const deviceId = series.id.split(':')[0] ?? '';
      const roomId = devicesById.get(deviceId)?.roomId ?? firstOccupiedRoom(snapshot);
      return {
        id: `telemetry:${series.id}`,
        kind: 'comfort' as const,
        priority: series.thresholdStatus === 'alert' ? 62 : 48,
        headline: series.label,
        summary: series.insight,
        roomId,
        roomName: formatRoomName(roomId),
        action: recommendedTelemetryAction(series.id),
        sourceId: series.id
      };
    });
  const healthItems = deviceHealthCards.map((card) => ({
    id: `device-health:${card.id}`,
    kind: 'device_health' as const,
    priority: card.priority,
    headline: `${card.displayName} ${card.signal.toLowerCase()}`,
    summary: `${card.roomName}: ${card.recommendedAction}`,
    roomId: devicesById.get(card.deviceId)?.roomId ?? firstOccupiedRoom(snapshot),
    roomName: card.roomName,
    action: card.recommendedAction,
    sourceId: card.deviceId
  }));
  const activity = createHouseholdActivity(snapshot);
  const activityItem: PriorityItem = {
    id: `activity:${snapshot.scenarioId}`,
    kind: 'activity',
    priority: 10,
    headline: activity.title,
    summary: activity.summary,
    roomId: firstOccupiedRoom(snapshot),
    roomName: activity.roomName,
    action: activity.nextAction
  };
  return [...alertItems, ...healthItems, ...telemetryItems, ...automationItems, activityItem]
    .sort((left, right) => prioritySortValue(right) - prioritySortValue(left) || left.headline.localeCompare(right.headline));
}

function prioritySortValue(item: PriorityItem): number {
  return item.kind === 'alert' ? item.priority + 100 : item.priority;
}

function createHomeBriefing(
  snapshot: TwinSnapshot,
  alertSummary: AlertStatusSummary,
  priorityQueue: PriorityItem[],
  automationExplanations: AutomationExplanation[]
): HomeBriefing {
  const primaryItem = priorityQueue[0] ?? null;
  const status: HomeBriefing['status'] = alertSummary.unresolved > 0
    ? 'Needs attention'
    : priorityQueue.some((item) => item.priority >= 48)
      ? 'Watch'
      : 'Good';
  const unresolvedText = alertSummary.unresolved === 1 ? '1 item needs handling' : `${alertSummary.unresolved} items need handling`;
  const summary = alertSummary.unresolved > 0
    ? unresolvedText
    : snapshot.homeState.occupancyCount > 0
      ? 'Household routines are running normally'
      : 'Home is monitoring security while everyone is away';
  const latestAutomation = automationExplanations[0];
  return {
    status,
    summary,
    primaryItem,
    highlights: [
      primaryItem ? primaryItem.summary : summary,
      latestAutomation ? `Latest automation: ${latestAutomation.ruleName}` : 'No automation has fired yet',
      `Mode: ${snapshot.homeState.mode.replaceAll('_', ' ')}`
    ],
    nextAction: primaryItem?.action ?? inferNextAction(snapshot.homeState.mode)
  };
}

function alertPriority(alert: AlertState): number {
  const severityRank: Record<AlertState['severity'], number> = { info: 52, warning: 72, high: 96 };
  const status = getAlertLifecycleStatus(alert);
  const statusPenalty = status === 'acknowledged' ? 10 : status === 'ignored' ? 28 : 0;
  return severityRank[alert.severity] - statusPenalty;
}

function formatEvent(event: TwinEvent): DashboardEvent {
  if (event.type === 'AlertCreated') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${event.message} (${event.severity})` };
  }
  if (event.type === 'AlertStatusChanged') {
    return {
      id: event.id,
      time: event.simTime,
      type: event.type,
      label: `${formatAlertTitle(event.alertId)} status changed from ${event.previousStatus} to ${event.status}`
    };
  }
  if (event.type === 'AbnormalityInjected') {
    const affected = event.affectedEntities.map(formatAffectedEntity).join(', ');
    return {
      id: event.id,
      time: event.simTime,
      type: event.type,
      label: `${formatAbnormalityKind(event.kind)} injected; affected: ${affected}`
    };
  }
  if (event.type === 'RuleRecovered') {
    const facts = event.recoveredFacts.map(formatMatchedFact).join(', ');
    return {
      id: event.id,
      time: event.simTime,
      type: event.type,
      label: `${formatRuleName(event.ruleId)} recovered after ${facts}`
    };
  }
  if (event.type === 'AutomationTriggered') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${formatRuleName(event.ruleId)}: ${event.explanation}` };
  }
  if (event.type === 'ActivityStarted') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${formatActivity(event.activityId)} started in ${formatRoomName(event.roomId)}` };
  }
  if (event.type === 'PersonMoved') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${formatPerson(event.personId)} moved to ${formatRoomName(event.to)} for ${formatActivity(event.activity)}` };
  }
  if (event.type === 'DeviceStateChanged') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${formatDeviceName(event.deviceId)} changed because ${formatReason(event.reason ?? 'unknown')}` };
  }
  if (event.type === 'DeviceTelemetry') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${formatDeviceName(event.deviceId)} telemetry updated` };
  }
  return { id: event.id, time: event.simTime, type: event.type, label: event.type };
}

function createTelemetrySeries(events: TwinEvent[]): DashboardModel['telemetrySeries'] {
  const series = new Map<string, { id: string; label: string; points: number[] }>();
  const automationsByRoom = createAutomationRoomMap(events);
  for (const event of events) {
    if (event.type !== 'DeviceTelemetry') {
      continue;
    }
    if (event.deviceType === 'doorbell_camera' || event.deviceType === 'security_camera') {
      continue;
    }
    for (const [metric, value] of Object.entries(event.measurements)) {
      if (typeof value !== 'number') {
        continue;
      }
      const id = `${event.deviceId}:${metric}`;
      const item = series.get(id) ?? { id, label: `${formatDeviceName(event.deviceId)} ${formatMetric(metric)}`, points: [] };
      item.points.push(value);
      series.set(id, item);
    }
  }
  return [...series.values()]
    .filter((item) => item.points.length > 1)
    .slice(0, 6)
    .map((item) => enrichTelemetrySeries(item, automationsByRoom));
}

function createAutomationRoomMap(events: TwinEvent[]): Map<RoomId, string> {
  const automationRooms = new Map<RoomId, string>();
  for (const event of events) {
    if (event.type !== 'AutomationTriggered') {
      continue;
    }
    const roomId = inferAutomationRoom(event.ruleId);
    if (roomId) {
      automationRooms.set(roomId, formatRuleName(event.ruleId));
    }
  }
  return automationRooms;
}

function createFloorplanRooms(snapshot: TwinSnapshot, events: TwinEvent[]): DashboardModel['floorplanRooms'] {
  const rooms = (Object.keys(snapshot.rooms) as RoomId[]).reduce<DashboardModel['floorplanRooms']>((roomMap, roomId) => {
    roomMap[roomId] = {
      people: [],
      devices: [],
      activeDeviceCount: 0
    };
    return roomMap;
  }, {} as DashboardModel['floorplanRooms']);
  const recentlyMovedPeople = new Set(events
    .filter((event) => event.type === 'PersonMoved')
    .slice(-8)
    .map((event) => event.personId));

  for (const person of Object.values(snapshot.people)) {
    if (person.location === 'away') {
      continue;
    }
    const room = rooms[person.location];
    room.people.push({
      id: person.id,
      label: formatPerson(person.id),
      activity: person.activity,
      slot: room.people.length,
      recent: recentlyMovedPeople.has(person.id)
    });
  }

  for (const device of Object.values(snapshot.devices)) {
    const room = rooms[device.roomId];
    const active = isDeviceTypeActive(device.type, device.state);
    room.devices.push({
      id: device.id,
      label: getDeviceCapability(device.type).shortLabel,
      summary: summarizeDeviceState(device.type, device.state),
      active,
      slot: room.devices.length
    });
    if (active) {
      room.activeDeviceCount += 1;
    }
  }

  return rooms;
}

function createBehaviorCards(snapshot: TwinSnapshot): BehaviorCard[] {
  return Object.values(snapshot.people)
    .map((person) => {
      const behavior = person.behavior ?? {
        routinePhase: snapshot.homeState.mode,
        intent: person.activity,
        attentionTarget: person.location,
        energy: 50
      };
      return {
        personId: person.id,
        label: formatPerson(person.id),
        roomId: person.location,
        roomName: formatRoomName(person.location),
        activity: formatBehaviorText(person.activity),
        routinePhase: formatBehaviorText(behavior.routinePhase),
        intent: formatBehaviorText(behavior.intent),
        attentionTarget: formatBehaviorTarget(behavior.attentionTarget),
        energy: behavior.energy,
        priority: behaviorPriority(person.id, behavior.intent, behavior.routinePhase, behavior.energy)
      };
    })
    .sort((left, right) => right.priority - left.priority || left.personId.localeCompare(right.personId));
}

function createDeviceLifecycleCards(snapshot: TwinSnapshot): DeviceLifecycleCard[] {
  return Object.values(snapshot.devices)
    .flatMap((device) => {
      if (device.state.status !== 'waiting_unload') {
        return [];
      }
      const definition = devicesById.get(device.id);
      const displayName = definition?.name ?? formatDeviceName(device.id);
      const relatedAlert = Object.values(snapshot.alerts)
        .find((alert) => alert.roomId === device.roomId && alert.recommendedAction === lifecycleRecommendedAction(device.type));
      return [{
        deviceId: device.id,
        displayName,
        roomName: formatRoomName(device.roomId),
        status: formatBehaviorText(String(device.state.status)),
        headline: lifecycleHeadline(displayName, device.type),
        nextAction: formatAction(relatedAlert?.recommendedAction ?? lifecycleRecommendedAction(device.type)),
        priority: lifecyclePriority(device.type),
        relatedAlertId: relatedAlert?.id ?? null
      }];
    })
    .sort((left, right) => right.priority - left.priority || left.displayName.localeCompare(right.displayName));
}

function createCausalEvents(snapshot: TwinSnapshot, events: TwinEvent[]): CausalEventCard[] {
  return events
    .flatMap((event) => {
      const explanation = event.eventExplanation ?? inferEventExplanation(snapshot, event);
      if (!explanation) {
        return [];
      }
      const ruleId = event.type === 'AutomationTriggered'
        ? event.ruleId
        : event.type === 'AlertCreated'
          ? event.sourceRuleId ?? null
          : null;
      const actions = event.type === 'AutomationTriggered'
        ? event.actions.map(formatAction)
        : event.type === 'AlertCreated'
          ? [formatAction(event.recommendedAction)]
          : [];
      return [{
        eventId: event.id,
        time: event.simTime,
        type: event.type,
        ruleId,
        why: explanation.why,
        actors: explanation.actorIds.map(formatPerson),
        affectedDevices: explanation.affectedDeviceIds.map(formatDeviceName),
        affectedRooms: explanation.affectedRoomIds.map(formatRoomName),
        relatedIntent: explanation.relatedIntent ? formatBehaviorText(explanation.relatedIntent) : null,
        expectedOutcome: explanation.expectedOutcome,
        actions,
        priority: causalEventPriority(event.type, ruleId, explanation)
      }];
    })
    .sort((left, right) => right.time.localeCompare(left.time) || right.priority - left.priority);
}

function createBehaviorAudit(
  snapshot: TwinSnapshot,
  events: TwinEvent[],
  behaviorCards: BehaviorCard[],
  deviceLifecycleCards: DeviceLifecycleCard[],
  causalEvents: CausalEventCard[]
): BehaviorAudit {
  const people = behaviorCards.map((card) => {
    const relatedEvents = causalEvents.filter((event) => event.actors.includes(card.label));
    const memory = summarizeAgentMemory(card.personId, events);
    return {
      personId: card.personId,
      label: card.label,
      location: card.roomName,
      activity: card.activity,
      intent: card.intent,
      routinePhase: card.routinePhase,
      energy: card.energy,
      attentionTarget: card.attentionTarget,
      nextPlan: createNextPlan(card),
      memorySummary: memory.summary,
      nextCommitment: createBehaviorAuditCommitment(snapshot, card.personId),
      triggeredRules: uniqueSorted(relatedEvents.flatMap((event) => event.ruleId ? [formatRuleName(event.ruleId)] : [])),
      affectedByDevices: uniqueSorted(causalEvents
        .filter((event) => event.affectedDevices.includes(card.attentionTarget))
        .flatMap((event) => event.affectedDevices)),
      affectsDevices: uniqueSorted(relatedEvents.flatMap((event) => event.affectedDevices))
    };
  });

  return {
    people,
    deviceLifecycles: deviceLifecycleCards,
    recentCausalEvents: causalEvents.slice(0, 10),
    unresolvedTasks: createBehaviorAuditTasks(snapshot, deviceLifecycleCards),
    consistencyWarnings: createBehaviorConsistencyWarnings(snapshot, behaviorCards, deviceLifecycleCards, causalEvents)
  };
}

function createBehaviorAuditCommitment(snapshot: TwinSnapshot, personId: string): BehaviorAuditCommitment | null {
  const minute = minutesOfDay(snapshot.simClock.currentTime);
  let commitments: DailyCommitment[];
  try {
    commitments = createDailyCommitments({
      persona: getPersona(personId),
      date: snapshot.runContext.startedAt.slice(0, 10),
      seed: snapshot.runContext.seed
    }).filter((commitment) => commitment.personId === personId);
  } catch {
    return null;
  }
  const ranked = commitments
    .map((commitment) => ({
      commitment,
      pressure: commitmentPressureAtMinute(commitments, minute, commitment.activityId)
    }))
    .filter(({ commitment, pressure }) => pressure > 0 || commitment.window.endMinute >= minute)
    .sort((left, right) => right.pressure - left.pressure || left.commitment.window.startMinute - right.commitment.window.startMinute)[0];
  if (!ranked) {
    return null;
  }
  return {
    activity: formatActivity(ranked.commitment.activityId).toLowerCase(),
    roomName: formatRoomName(ranked.commitment.roomId),
    window: `${formatMinute(ranked.commitment.window.startMinute)}-${formatMinute(ranked.commitment.window.endMinute)}`,
    pressure: Math.round(ranked.pressure),
    source: ranked.commitment.source
  };
}

function inferEventExplanation(snapshot: TwinSnapshot, event: TwinEvent): EventExplanation | null {
  if (event.type === 'AlertCreated') {
    return {
      why: event.message,
      actorIds: [],
      affectedDeviceIds: event.sourceEntityIds?.filter((entityId) => devicesById.has(entityId)) ?? [],
      affectedRoomIds: [event.roomId],
      expectedOutcome: `Prompt review: ${formatAction(event.recommendedAction)}.`
    };
  }

  if (event.type !== 'AutomationTriggered') {
    return null;
  }

  const actorIds = inferActorIdsFromReason(event.reason ?? '');
  const affectedDeviceIds = inferAffectedDeviceIds(event.ruleId);
  const affectedRoomIds = inferAffectedRoomIds(snapshot, event.ruleId, affectedDeviceIds);
  return {
    why: event.explanation,
    actorIds,
    affectedDeviceIds,
    affectedRoomIds,
    relatedIntent: actorIds.map((actorId) => snapshot.people[actorId]?.behavior.intent).find(Boolean),
    expectedOutcome: event.actions[0] ? `Expected outcome from ${formatAction(event.actions[0])}.` : 'Keep the household state coherent.'
  };
}

function inferActorIdsFromReason(reason: string): string[] {
  const match = /(?:habit|activity|operator):([^:]+)/.exec(reason);
  return match?.[1] && personLabels[match[1]] ? [match[1]] : [];
}

function inferAffectedDeviceIds(ruleId: string): string[] {
  const deviceIds: Record<string, string[]> = {
    cooking_ventilation: ['stove_01', 'range_hood_01', 'kitchen_light_01'],
    stove_unattended_safety: ['stove_01'],
    away_mode: ['door_lock_01', 'living_light_01', 'tv_01'],
    close_water_valve_on_leak: ['water_leak_01', 'water_valve_01'],
    fridge_left_open: ['fridge_01'],
    network_offline: ['router_01'],
    door_left_open: ['door_lock_01', 'doorbell_camera_01'],
    senior_no_activity: ['master_sleep_01'],
    senior_wellness_check: ['master_sleep_01'],
    child_homework_focus: ['child_sleep_01', 'tv_01', 'living_light_01'],
    remote_work_comfort: ['study_co2_01', 'router_01'],
    commuter_arrival_scene: ['living_light_01', 'living_curtain_01'],
    senior_garden_care: ['sprinkler_01', 'garden_soil_01'],
    pet_garden_sprinkler_pause: ['sprinkler_01'],
    dishwasher_waiting_unload: ['dishwasher_01'],
    washer_waiting_unload: ['washer_01']
  };
  return deviceIds[ruleId] ?? [];
}

function inferAffectedRoomIds(snapshot: TwinSnapshot, ruleId: string, affectedDeviceIds: string[]): RoomId[] {
  const roomIds = affectedDeviceIds.flatMap((deviceId) => {
    const device = snapshot.devices[deviceId];
    return device ? [device.roomId] : [];
  });
  const fallbackRoom = inferAutomationRoom(ruleId);
  return uniqueRoomIds([...roomIds, ...(fallbackRoom ? [fallbackRoom] : [])]);
}

function causalEventPriority(type: TwinEvent['type'], ruleId: string | null, explanation: EventExplanation): number {
  const typeScore = type === 'AlertCreated' ? 80 : 55;
  const ruleScore = ruleId && ['close_water_valve_on_leak', 'network_offline', 'senior_no_activity', 'fridge_left_open'].includes(ruleId) ? 20 : 0;
  const actorScore = explanation.actorIds.length > 0 ? 8 : 0;
  return typeScore + ruleScore + actorScore + explanation.affectedDeviceIds.length;
}

function createNextPlan(card: BehaviorCard): string {
  if (card.roomId === 'away') {
    return `Continue ${card.intent} away from home`;
  }
  return `Continue ${card.intent} near ${card.attentionTarget}`;
}

function createBehaviorAuditTasks(snapshot: TwinSnapshot, deviceLifecycleCards: DeviceLifecycleCard[]): BehaviorAuditTask[] {
  const alertTasks = activeAlerts(snapshot).map((alert) => ({
    id: `alert:${alert.id}`,
    label: alert.message,
    owner: ownerForAction(alert.recommendedAction),
    source: formatRoomName(alert.roomId),
    status: getAlertLifecycleStatus(alert)
  }));
  const lifecycleTasks = deviceLifecycleCards.map((card) => ({
    id: `lifecycle:${card.deviceId}`,
    label: card.headline,
    owner: ownerForAction(card.nextAction),
    source: card.roomName,
    status: card.status
  }));
  return [...alertTasks, ...lifecycleTasks];
}

function createBehaviorConsistencyWarnings(
  snapshot: TwinSnapshot,
  behaviorCards: BehaviorCard[],
  deviceLifecycleCards: DeviceLifecycleCard[],
  causalEvents: CausalEventCard[]
): string[] {
  const warnings: string[] = [];
  const humanCards = behaviorCards.filter((card) => snapshot.people[card.personId]?.kind === 'human' && card.roomId !== 'away');
  const minutes = minutesOfDay(snapshot.simClock.currentTime);
  if (minutes >= 600 && humanCards.length > 0 && humanCards.every((card) => card.intent === 'rest')) {
    warnings.push('All household members are still sleeping after the morning routine window.');
  }
  if (activeAlerts(snapshot).length > 0 && causalEvents.length === 0) {
    warnings.push('Active alerts exist without causal explanations.');
  }
  if (deviceLifecycleCards.some((card) => card.relatedAlertId === null)) {
    warnings.push('A device lifecycle task is waiting without an alert workflow.');
  }
  return warnings;
}

function createDeviceControlCards(snapshot: TwinSnapshot, events: TwinEvent[]): DeviceControlCard[] {
  const latestStateChangeByDevice = new Map<string, Extract<TwinEvent, { type: 'DeviceStateChanged' }>>();
  const recentEventsByDevice = new Map<string, DeviceRecentEvent[]>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === 'DeviceStateChanged') {
      latestStateChangeByDevice.set(event.deviceId, event);
      appendDeviceRecentEvent(recentEventsByDevice, event.deviceId, {
        id: event.id,
        type: event.type,
        time: event.simTime,
        sequence: event.sequence,
        label: summarizeRecord(event.state),
        reason: event.reason ?? null
      });
    } else if (event.type === 'DeviceTelemetry') {
      appendDeviceRecentEvent(recentEventsByDevice, event.deviceId, {
        id: event.id,
        type: event.type,
        time: event.simTime,
        sequence: event.sequence,
        label: summarizeRecord(event.measurements),
        reason: event.reason ?? null
      });
    }
  }
  return Object.values(snapshot.devices)
    .map((device) => createDeviceControlCard(device, latestStateChangeByDevice.get(device.id), recentEventsByDevice.get(device.id) ?? []))
    .sort((left, right) => left.roomName.localeCompare(right.roomName) || left.displayName.localeCompare(right.displayName));
}

function createDeviceControlCard(
  device: DeviceState,
  latestStateChange: Extract<TwinEvent, { type: 'DeviceStateChanged' }> | undefined,
  recentEvents: DeviceRecentEvent[]
): DeviceControlCard {
  const capability = getDeviceCapability(device.type);
  const supportedCommands = getDeviceSupportedCommands(device.id, device.type);
  const commandMetadata = getDeviceCommandMetadataForInstance(device.id, device.type);
  const connectivity = device.state.online === false ? 'offline' : 'online';
  const disabledReason = connectivity === 'offline' ? 'Device is offline' : null;
  const sortedRecentEvents = recentEvents.slice(-4).reverse();
  return {
    deviceId: device.id,
    displayName: formatDeviceName(device.id),
    roomName: formatRoomName(device.roomId),
    deviceType: device.type,
    statusLabel: summarizeDeviceState(device.type, device.state),
    connectivity,
    disabledReason,
    commandStatus: latestStateChange ? commandStatusForDeviceStateChange(latestStateChange) : 'none',
    commandTimeline: latestStateChange ? createDeviceCommandTimeline({
      terminalStatus: commandStatusForDeviceStateChange(latestStateChange) === 'failed' ? 'failed' : 'acknowledged',
      at: latestStateChange.simTime,
      reason: latestStateChange.reason ?? null
    }) : [],
    lastEventAt: sortedRecentEvents[0]?.time ?? null,
    recentEvents: sortedRecentEvents,
    controls: supportedCommands.map((command) => createDeviceCommandControl(command, device, disabledReason, commandMetadata[command]))
  };
}

function commandStatusForDeviceStateChange(event: Extract<TwinEvent, { type: 'DeviceStateChanged' }>): DeviceControlCard['commandStatus'] {
  if (event.reason === 'abnormality:network_degraded') {
    return 'acknowledged';
  }
  if (event.reason?.startsWith('abnormality:')) {
    return 'failed';
  }
  return 'acknowledged';
}

function appendDeviceRecentEvent(
  eventsByDevice: Map<string, DeviceRecentEvent[]>,
  deviceId: string,
  event: DeviceRecentEvent
): void {
  const events = eventsByDevice.get(deviceId) ?? [];
  events.push(event);
  eventsByDevice.set(deviceId, events);
}

function summarizeRecord(record: Record<string, string | number | boolean | null>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function createDeviceCommandControl(
  command: string,
  device: DeviceState,
  disabledReason: string | null,
  metadata: ReturnType<typeof getDeviceCapability>['commandMetadata'][string]
): DeviceCommandControl {
  const field = metadata.field;
  const base = {
    command,
    label: metadata.label,
    field,
    value: field ? device.state[field] ?? null : null,
    disabled: Boolean(disabledReason),
    disabledReason,
    highRisk: metadata.highRisk,
    requiresConfirmation: metadata.requiresConfirmation,
    valueType: metadata.valueType,
    failureReasons: [...metadata.failureReasons]
  };
  if (metadata.controlType === 'select') {
    return { ...base, controlType: 'select', options: [...(metadata.options ?? [])] };
  }
  if (metadata.controlType === 'slider') {
    return { ...base, controlType: 'slider', min: metadata.min ?? 0, max: metadata.max ?? 100 };
  }
  return { ...base, controlType: metadata.controlType };
}

function createDeviceHealthCards(snapshot: TwinSnapshot, events: TwinEvent[]): DeviceHealthCard[] {
  const latestSeenAtByDevice = new Map<string, string>();
  const telemetryHistoryByDevice = new Map<string, Map<string, Array<{ value: number; time: string; sequence: number }>>>();
  const commandFailuresByDevice = new Map<string, number>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === 'DeviceStateChanged' || event.type === 'DeviceTelemetry') {
      latestSeenAtByDevice.set(event.deviceId, event.simTime);
    }
    if (event.type === 'DeviceStateChanged' && commandStatusForDeviceStateChange(event) === 'failed') {
      commandFailuresByDevice.set(event.deviceId, (commandFailuresByDevice.get(event.deviceId) ?? 0) + 1);
    }
    if (event.type === 'DeviceTelemetry') {
      appendTelemetryHistory(telemetryHistoryByDevice, event);
    }
  }

  return Object.values(snapshot.devices)
    .flatMap((device) => {
      const capability = getDeviceCapability(device.type);
      const healthStatuses = evaluateDeviceHealthSignals(
        capability.healthSignals,
        device.state,
        latestSeenAtByDevice.get(device.id) ?? snapshot.simClock.currentTime,
        snapshot.simClock.currentTime
      );
      const healthCards = healthStatuses
        .filter((health): health is typeof health & { status: DeviceHealthCard['status'] } => health.status !== 'normal')
        .map((health) => ({
          id: deviceHealthSignalId(device.id, health.kind, health.sourceField),
          deviceId: device.id,
          displayName: formatDeviceName(device.id),
          roomName: formatRoomName(device.roomId),
          signal: health.label,
          kind: health.kind,
          status: health.status,
          priority: healthPriority(health.status, health.impact),
          sourceField: health.sourceField,
          reportedValue: health.reportedValue,
          recommendedAction: health.recommendation,
          expectedEffect: expectedHealthEffect(health.impact),
          impact: health.impact,
          maintenanceAction: maintenanceActionForHealth(health.kind),
          maintenanceLabel: maintenanceLabelForHealth(health.kind),
          focusDeviceId: device.id
        }));
      return [
        ...healthCards,
        ...createCommandFailureHealthCards(device, commandFailuresByDevice.get(device.id) ?? 0),
        ...createTelemetryDriftHealthCards(device, telemetryHistoryByDevice.get(device.id) ?? new Map())
      ];
    })
    .sort((left, right) => right.priority - left.priority || left.displayName.localeCompare(right.displayName))
    .slice(0, 8);
}

function createCommandFailureHealthCards(device: DeviceState, failureCount: number): DeviceHealthCard[] {
  if (failureCount < 3) {
    return [];
  }
  const capability = getDeviceCapability(device.type);
  const impact = capability.healthSignals.find((signal) => signal.kind === 'connectivity' || signal.kind === 'latency')?.impact ?? 'automation_reliability';
  return [{
    id: `device-health:${device.id}:command_failure`,
    deviceId: device.id,
    displayName: formatDeviceName(device.id),
    roomName: formatRoomName(device.roomId),
    signal: 'Command failure rate',
    kind: 'command_failure',
    status: 'alert',
    priority: healthPriority('alert', impact) + 6,
    sourceField: 'commandStatus',
    reportedValue: `${failureCount} failed commands`,
    recommendedAction: 'Inspect command routing and device availability before relying on automations.',
    expectedEffect: expectedHealthEffect(impact),
    impact,
    maintenanceAction: maintenanceActionForHealth('command_failure'),
    maintenanceLabel: maintenanceLabelForHealth('command_failure'),
    focusDeviceId: device.id
  }];
}

function deviceHealthSignalId(deviceId: string, kind: DeviceHealthSignalKind, sourceField: string | null): string {
  return `device-health:${deviceId}:${kind}${sourceField ? `:${sourceField}` : ''}`;
}

function appendTelemetryHistory(
  historyByDevice: Map<string, Map<string, Array<{ value: number; time: string; sequence: number }>>>,
  event: Extract<TwinEvent, { type: 'DeviceTelemetry' }>
): void {
  let deviceHistory = historyByDevice.get(event.deviceId);
  if (!deviceHistory) {
    deviceHistory = new Map();
    historyByDevice.set(event.deviceId, deviceHistory);
  }
  for (const [field, value] of Object.entries(event.measurements)) {
    if (typeof value !== 'number') {
      continue;
    }
    const entries = deviceHistory.get(field) ?? [];
    entries.push({ value, time: event.simTime, sequence: event.sequence });
    deviceHistory.set(field, entries);
  }
}

function createTelemetryDriftHealthCards(
  device: DeviceState,
  telemetryHistory: Map<string, Array<{ value: number; time: string; sequence: number }>>
): DeviceHealthCard[] {
  return [...telemetryHistory.entries()]
    .filter(([field]) => isDriftSensitiveTelemetryField(field))
    .filter(([, entries]) => isFlatTelemetry(entries))
    .map(([field, entries]) => {
      const capability = getDeviceCapability(device.type);
      const impact = capability.healthSignals.find((signal) => (
        signal.sourceField === field || signal.sourceField === telemetryFieldToStateField(field)
      ))?.impact ?? 'automation_reliability';
      const latest = entries.at(-1);
      return {
        id: `device-health:${device.id}:drift:${field}`,
        deviceId: device.id,
        displayName: formatDeviceName(device.id),
        roomName: formatRoomName(device.roomId),
        signal: 'Reading drift',
        kind: 'drift' as const,
        status: 'watch' as const,
        priority: healthPriority('watch', impact) + 14,
        sourceField: field,
        reportedValue: latest?.value ?? null,
        recommendedAction: 'Calibrate the sensor or inspect whether the reading is stuck.',
        expectedEffect: expectedHealthEffect(impact),
        impact,
        maintenanceAction: maintenanceActionForHealth('drift'),
        maintenanceLabel: maintenanceLabelForHealth('drift'),
        focusDeviceId: device.id
      };
    });
}

function isDriftSensitiveTelemetryField(field: string): boolean {
  const lower = field.toLowerCase();
  return lower.includes('moisture') || lower.includes('humidity') || lower.includes('temperature') || lower.includes('pm25') || lower.includes('co2');
}

function isFlatTelemetry(entries: Array<{ value: number; time: string; sequence: number }>): boolean {
  const recent = entries.slice(-4);
  if (recent.length < 4) {
    return false;
  }
  const first = recent[0].value;
  return recent.every((entry) => Math.abs(entry.value - first) <= 0.15);
}

function telemetryFieldToStateField(field: string): string {
  return field.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function createPredictionCards(snapshot: TwinSnapshot): PredictionCard[] {
  return activeAlerts(snapshot)
    .flatMap((alert) => predictionCardForAlert(alert, snapshot))
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 4);
}

function createForecastTelemetrySeries(predictionCards: PredictionCard[]): ForecastTelemetrySeries[] {
  return predictionCards.flatMap((card) =>
    card.forecastPoints.map((point) => ({
      id: `forecast:${card.alertId}:${point.metric}`,
      alertId: card.alertId,
      metric: point.metric,
      unit: point.unit,
      horizonMinutes: [0, 5, 10, 15],
      ignored: [...point.ignored],
      handledNow: [...point.handledNow],
      confidenceInterval: structuredClone(point.confidenceInterval)
    }))
  );
}

function predictionCardForAlert(alert: AlertState, snapshot: TwinSnapshot): PredictionCard[] {
  if (alert.id === 'fridge_left_open_001') {
    const model = createFridgeForecastModel(snapshot);
    const forecastPoints = createFridgeForecastPoints(model);
    const title = 'Fridge door left open forecast';
    return [{
      id: `prediction:${alert.id}`,
      alertId: alert.id,
      horizon: '15 min',
      title,
      forecast: 'Kitchen appliance risk will keep rising if the door remains open.',
      ifIgnored: 'Fridge power draw stays elevated, kitchen temperature may drift upward, and the alert should escalate.',
      ifHandledNow: 'adult_1 can close fridge_01 now to return power draw to normal and resolve the alert.',
      impact: 'energy',
      roomName: formatRoomName(alert.roomId),
      relatedDeviceId: 'fridge_01',
      forecastPoints,
      forecastModel: model,
      chart: createForecastChart(alert.id, title, forecastPoints),
      recoveryEstimate: createFridgeRecoveryEstimate(snapshot, forecastPoints),
      priority: predictionPriority(alert, 8)
    }];
  }
  if (alert.id === 'network_offline_001') {
    const forecastPoints = [
      createForecastPoint('router_latency_ms', 'ms', [0, 0, 0, 0], [0, 80, 32, 18], 'high'),
      createForecastPoint('video_call_quality_score', '%', [35, 25, 18, 12], [35, 62, 84, 92], 'medium'),
      createForecastPoint('notification_delay_s', 's', [90, 120, 150, 180], [90, 35, 12, 5], 'medium'),
      createForecastPoint('automation_ack_delay_s', 's', [45, 75, 110, 150], [45, 18, 8, 4], 'medium')
    ];
    const title = 'Network outage forecast';
    return [{
      id: `prediction:${alert.id}`,
      alertId: alert.id,
      horizon: '15 min',
      title,
      forecast: 'Connectivity-dependent automation will remain unreliable until the router recovers.',
      ifIgnored: 'remote work, notifications, and device command acknowledgement can stay degraded.',
      ifHandledNow: 'adult_2 can restart router_01 now and restore connectivity-sensitive automations.',
      impact: 'automation_reliability',
      roomName: formatRoomName(alert.roomId),
      relatedDeviceId: 'router_01',
      forecastPoints,
      forecastModel: createGenericForecastModel('router_reconnect_model', snapshot),
      chart: createForecastChart(alert.id, title, forecastPoints),
      recoveryEstimate: createRouterRecoveryEstimate(snapshot, forecastPoints),
      priority: predictionPriority(alert, 10)
    }];
  }
  if (alert.id === 'senior_no_activity_001') {
    const forecastPoints = [
      createForecastPoint('care_uncertainty_score', '%', [45, 58, 72, 84], [45, 22, 8, 4], 'medium'),
      createForecastPoint('check_in_urgency_score', '%', [52, 66, 78, 88], [52, 28, 12, 6], 'medium')
    ];
    const title = 'Senior activity forecast';
    return [{
      id: `prediction:${alert.id}`,
      alertId: alert.id,
      horizon: '15 min',
      title,
      forecast: 'The care signal remains uncertain until someone checks the room or the sleep sensor clears.',
      ifIgnored: 'A normal late wake-up and a real inactivity concern remain indistinguishable.',
      ifHandledNow: 'adult_1 or adult_2 can check on senior_1 and either resolve or escalate the care workflow.',
      impact: 'care',
      roomName: formatRoomName(alert.roomId),
      relatedDeviceId: 'master_sleep_01',
      forecastPoints,
      forecastModel: createGenericForecastModel('senior_care_risk_model', snapshot),
      chart: createForecastChart(alert.id, title, forecastPoints),
      recoveryEstimate: {
        operatorId: 'adult_1',
        action: 'check senior_1',
        estimatedRecoveryMinutes: 6,
        impactReductionPercent: estimateImpactReductionPercent(forecastPoints, 70),
        confidence: 'medium',
        basis: 'care uncertainty can drop once a family member confirms senior_1 is active or safe.'
      },
      priority: predictionPriority(alert, 12)
    }];
  }
  if (alert.id === 'door_left_open_001') {
    const forecastPoints = [
      createForecastPoint('entry_exposure_score', '%', [35, 50, 66, 80], [35, 12, 4, 2], 'high')
    ];
    const title = 'Entry security forecast';
    return [{
      id: `prediction:${alert.id}`,
      alertId: alert.id,
      horizon: '15 min',
      title,
      forecast: 'The entry remains exposed while the lock and doorbell camera report an unsecured state.',
      ifIgnored: 'Security mode and package monitoring remain less trustworthy.',
      ifHandledNow: 'Locking door_lock_01 restores the entry state and clears the security workflow.',
      impact: 'security',
      roomName: formatRoomName(alert.roomId),
      relatedDeviceId: 'door_lock_01',
      forecastPoints,
      forecastModel: createGenericForecastModel('entry_exposure_model', snapshot),
      chart: createForecastChart(alert.id, title, forecastPoints),
      recoveryEstimate: {
        operatorId: 'adult_1',
        action: 'lock door_lock_01',
        estimatedRecoveryMinutes: 2,
        impactReductionPercent: estimateImpactReductionPercent(forecastPoints, 75),
        confidence: 'high',
        basis: 'entry exposure can drop quickly once the door lock reports secured.'
      },
      priority: predictionPriority(alert, 9)
    }];
  }
  return [];
}

function createFridgeForecastModel(snapshot: TwinSnapshot): ForecastModelDetail {
  return {
    kind: 'fridge_thermal_load',
    season: seasonForTime(snapshot.simClock.currentTime),
    roomVolumeM3: 42,
    currentPowerW: Math.round(Number(snapshot.devices.fridge_01?.state.powerW ?? 148)),
    openMinutes: Math.max(0, Number(snapshot.devices.fridge_01?.state.openMinutes ?? 0)),
    currentTemperatureC: roundForecastValue(Number(snapshot.rooms.kitchen?.temperatureC ?? snapshot.devices.kitchen_temp_01?.state.temperatureC ?? 25))
  };
}

function createGenericForecastModel(kind: string, snapshot: TwinSnapshot): ForecastModelDetail {
  return {
    kind,
    season: seasonForTime(snapshot.simClock.currentTime),
    roomVolumeM3: null,
    currentPowerW: null,
    openMinutes: null,
    currentTemperatureC: null
  };
}

function createFridgeForecastPoints(model: ForecastModelDetail): ForecastPoint[] {
  const currentPower = model.currentPowerW ?? 148;
  const currentTemp = model.currentTemperatureC ?? 25;
  const openMinutes = model.openMinutes ?? 0;
  const seasonalHeatFactor = model.season === 'summer' ? 1 : model.season === 'winter' ? 0.55 : 0.78;
  const roomVolumeFactor = 42 / (model.roomVolumeM3 ?? 42);
  const ignoredPower = openMinutes === 0
    ? [currentPower, currentPower + 16, currentPower + 28, currentPower + 40]
    : [currentPower, currentPower + 12, currentPower + 22, currentPower + 30];
  const handledPower = openMinutes === 0
    ? [currentPower, 112, 94, 90]
    : [currentPower, Math.max(112, currentPower - 42), Math.max(94, currentPower - 74), 90];
  const heatStep = openMinutes === 0
    ? [0, 0.3, 0.8, 1.2]
    : [0, 0.5, 1, 1.4].map((value) => value * seasonalHeatFactor * roomVolumeFactor);
  const recoveryStep = openMinutes === 0
    ? [0, 0, -0.1, -0.1]
    : [0, -0.5, -1.2, -1.8].map((value) => value * seasonalHeatFactor);
  return [
    createForecastPoint('fridge_power_w', 'W', ignoredPower.map(roundForecastValue), handledPower.map(roundForecastValue), 'medium'),
    createForecastPoint(
      'kitchen_temperature_c',
      'C',
      heatStep.map((value) => roundForecastValue(currentTemp + value)),
      recoveryStep.map((value) => roundForecastValue(currentTemp + value)),
      'medium'
    )
  ];
}

function createForecastChart(alertId: string, title: string, forecastPoints: ForecastPoint[]): ForecastChart {
  const units = uniqueInOrder(forecastPoints.map((point) => point.unit));
  return {
    id: `chart:${alertId}`,
    title,
    alertId,
    horizonMinutes: [0, 5, 10, 15],
    yAxisLabel: units.join(' / '),
    series: forecastPoints.map((point) => ({
      metric: point.metric,
      label: point.metric.replaceAll('_', ' '),
      unit: point.unit,
      ignored: [...point.ignored],
      handledNow: [...point.handledNow],
      confidenceInterval: structuredClone(point.confidenceInterval)
    }))
  };
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function seasonForTime(isoTime: string): ForecastModelDetail['season'] {
  const month = new Date(isoTime).getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function createForecastPoint(
  metric: string,
  unit: string,
  ignored: number[],
  handledNow: number[],
  confidence: PredictionRecoveryEstimate['confidence']
): ForecastPoint {
  return {
    metric,
    unit,
    ignored,
    handledNow,
    confidenceInterval: createForecastConfidenceInterval(ignored, handledNow, confidence)
  };
}

function createForecastConfidenceInterval(
  ignored: number[],
  handledNow: number[],
  confidence: PredictionRecoveryEstimate['confidence']
): ForecastConfidenceInterval {
  const config = confidence === 'high'
    ? { levelPercent: 90, spreadPercent: 6 }
    : confidence === 'medium'
      ? { levelPercent: 80, spreadPercent: 10 }
      : { levelPercent: 70, spreadPercent: 16 };
  const spread = config.spreadPercent / 100;
  return {
    ...config,
    ignoredLow: ignored.map((value) => roundForecastValue(value * (1 - spread))),
    ignoredHigh: ignored.map((value) => roundForecastValue(value * (1 + spread))),
    handledNowLow: handledNow.map((value) => roundForecastValue(value * (1 - spread))),
    handledNowHigh: handledNow.map((value) => roundForecastValue(value * (1 + spread)))
  };
}

function roundForecastValue(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundDistribution<T extends string>(distribution: Record<T, number>): Record<T, number> {
  return Object.fromEntries(Object.entries(distribution).map(([key, value]) => [key, roundPercent(Number(value))])) as Record<T, number>;
}

function createFridgeRecoveryEstimate(
  snapshot: TwinSnapshot,
  forecastPoints: PredictionCard['forecastPoints']
): PredictionRecoveryEstimate {
  const openMinutes = Math.max(0, Number(snapshot.devices.fridge_01?.state.openMinutes ?? 0));
  return {
    operatorId: 'adult_1',
    action: 'close fridge_01',
    estimatedRecoveryMinutes: Math.min(8, 3 + Math.ceil(openMinutes / 6)),
    impactReductionPercent: estimateImpactReductionPercent(forecastPoints, 50),
    confidence: openMinutes >= 10 ? 'medium' : 'high',
    basis: `fridge_01 has been open for ${openMinutes} min, so recovery includes walking over, closing the door, and compressor normalization.`
  };
}

function createRouterRecoveryEstimate(
  snapshot: TwinSnapshot,
  forecastPoints: PredictionCard['forecastPoints']
): PredictionRecoveryEstimate {
  const phase = String(snapshot.devices.router_01?.state.lifecyclePhase ?? 'offline');
  const phaseMinutes: Record<string, number> = {
    degraded: 3,
    offline: 4,
    restarting: 3,
    reconnecting: 2,
    recovered: 1,
    online: 1
  };
  return {
    operatorId: 'adult_2',
    action: 'restart router_01',
    estimatedRecoveryMinutes: phaseMinutes[phase] ?? 4,
    impactReductionPercent: estimateImpactReductionPercent(forecastPoints, 65),
    confidence: phase === 'offline' || phase === 'restarting' || phase === 'reconnecting' ? 'high' : 'medium',
    basis: `router_01 is ${phase}, so recovery follows the router restart and reconnect lifecycle.`
  };
}

function estimateImpactReductionPercent(
  forecastPoints: PredictionCard['forecastPoints'],
  fallback: number
): number {
  const reductions = forecastPoints.flatMap((point) => {
    const ignored = point.ignored.at(-1);
    const handled = point.handledNow.at(-1);
    if (ignored === undefined || handled === undefined || ignored <= 0 || handled >= ignored) {
      return [];
    }
    return [Math.round(((ignored - handled) / ignored) * 100)];
  });
  if (reductions.length === 0) {
    return fallback;
  }
  return Math.max(...reductions);
}

function predictionPriority(alert: AlertState, boost: number): number {
  const severityScore = alert.severity === 'high' ? 80 : alert.severity === 'warning' ? 60 : 40;
  const statusBoost = alert.status === 'acknowledged' ? -8 : 0;
  return severityScore + boost + statusBoost;
}

function createInsightCards(
  snapshot: TwinSnapshot,
  telemetrySeries: DashboardModel['telemetrySeries'],
  deviceHealthCards: DeviceHealthCard[]
): InsightCard[] {
  const telemetryInsights = telemetrySeries.map((series) => {
    const deviceId = series.id.split(':')[0] ?? '';
    const metric = series.id.split(':')[1] ?? '';
    const device = snapshot.devices[deviceId];
    const category = insightCategory(metric, device?.type);
    return {
      id: `telemetry:${series.id}`,
      category,
      priority: insightPriority(series.thresholdStatus, category) + airQualityBoost(metric),
      title: insightTitle(metric, device?.roomId),
      reason: series.insight,
      recommendedAction: recommendedTelemetryAction(series.id),
      expectedEffect: expectedTelemetryEffect(metric),
      roomName: device ? formatRoomName(device.roomId) : 'Whole home',
      relatedDeviceId: deviceId,
      status: series.thresholdStatus
    };
  });
  const healthInsights = deviceHealthCards
    .slice(0, 4)
    .map((card) => ({
      id: card.id,
      category: 'device_health' as const,
      priority: card.priority,
      title: `${card.displayName} ${card.signal.toLowerCase()}`,
      reason: `${card.signal}: ${String(card.reportedValue)}`,
      recommendedAction: card.recommendedAction,
      expectedEffect: card.expectedEffect,
      roomName: card.roomName,
      relatedDeviceId: card.focusDeviceId,
      status: card.status
    }));
  return [...healthInsights, ...telemetryInsights]
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 8);
}

function healthPriority(status: DeviceHealthCard['status'], impact: DeviceHealthImpact): number {
  const statusScore = status === 'alert' ? 86 : 58;
  const impactBoost: Record<DeviceHealthImpact, number> = {
    automation_reliability: 8,
    care: 9,
    comfort: 5,
    energy: 3,
    safety: 7,
    security: 10,
    water: 8
  };
  return statusScore + impactBoost[impact];
}

function expectedHealthEffect(impact: DeviceHealthImpact): string {
  if (impact === 'automation_reliability') return 'Automation and command execution should become reliable again.';
  if (impact === 'security') return 'Security coverage should return to the expected level.';
  if (impact === 'water') return 'Water safety and irrigation decisions should become reliable again.';
  if (impact === 'comfort') return 'Comfort automation should have trustworthy readings again.';
  if (impact === 'care') return 'Care monitoring should regain a reliable signal.';
  if (impact === 'energy') return 'Energy and appliance behavior should be easier to trust.';
  return 'The device should provide dependable home state again.';
}

function maintenanceActionForHealth(kind: DeviceHealthSignalKind): DeviceHealthCard['maintenanceAction'] {
  if (kind === 'connectivity' || kind === 'latency') return 'restart';
  if (kind === 'battery') return 'replace_or_recharge';
  if (kind === 'drift' || kind === 'range') return 'calibrate';
  if (kind === 'command_failure' || kind === 'staleness') return 'inspect';
  return 'monitor';
}

function maintenanceLabelForHealth(kind: DeviceHealthSignalKind): string {
  if (kind === 'command_failure') return 'Inspect command path';
  const labels: Record<DeviceHealthCard['maintenanceAction'], string> = {
    restart: 'Restart or reconnect',
    replace_or_recharge: 'Replace or recharge',
    calibrate: 'Calibrate reading',
    inspect: 'Inspect signal',
    monitor: 'Monitor trend'
  };
  return labels[maintenanceActionForHealth(kind)];
}

function createHouseholdActivity(snapshot: TwinSnapshot): HouseholdActivity {
  const activeAlert = activeAlerts(snapshot).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (activeAlert) {
    return {
      title: `${formatRoomName(activeAlert.roomId)} ${formatAlertKind(activeAlert.message)} response`,
      summary: `${activeAlert.message}. System recommendation: ${formatAction(activeAlert.recommendedAction)}.`,
      roomName: formatRoomName(activeAlert.roomId),
      participants: Object.values(snapshot.people)
        .filter((person) => person.kind === 'human' && person.location !== 'away')
        .map((person) => formatPerson(person.id)),
      nextAction: `Confirm ${formatAction(activeAlert.recommendedAction)}`
    };
  }

  const activeActivity = Object.values(snapshot.activities)[0];
  if (activeActivity) {
    return {
      title: formatActivity(activeActivity.activityId),
      summary: `${activeActivity.participants.map(formatPerson).join(', ')} in ${formatRoomName(activeActivity.roomId)}.`,
      roomName: formatRoomName(activeActivity.roomId),
      participants: activeActivity.participants.map(formatPerson),
      nextAction: inferNextAction(snapshot.homeState.mode)
    };
  }

  const activePerson = Object.values(snapshot.people)
    .filter((person) => person.kind === 'human' && person.location !== 'away')
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (activePerson) {
    return {
      title: formatActivity(activePerson.activity),
      summary: `${formatPerson(activePerson.id)} is ${formatActivity(activePerson.activity).toLowerCase()} in ${formatRoomName(activePerson.location)}.`,
      roomName: formatRoomName(activePerson.location),
      participants: [formatPerson(activePerson.id)],
      nextAction: inferNextAction(snapshot.homeState.mode)
    };
  }

  return {
    title: 'Away mode',
    summary: 'All human family members are away and the home is monitoring security state.',
    roomName: 'Whole home',
    participants: [],
    nextAction: 'Watch for arrival or security events'
  };
}

function createControlRecords(events: TwinEvent[]): ControlRecord[] {
  const automations = new Map(events
    .filter((event) => event.type === 'AutomationTriggered')
    .map((event) => [event.ruleId, event]));
  const previousStateByDevice = new Map<string, string>();
  const peopleByRoom = new Map<RoomId, Set<string>>();
  const activityPeopleByRoom = new Map<RoomId, Set<string>>();
  const alertSeverityByRoom = new Map<RoomId, AlertState['severity']>();
  const records: ControlRecord[] = [];

  for (const event of events) {
    if (event.type === 'PersonMoved') {
      removePersonFromRooms(peopleByRoom, event.personId);
      if (event.to !== 'away') {
        addPersonToRoom(peopleByRoom, event.to, event.personId);
      }
      continue;
    }

    if (event.type === 'ActivityStarted') {
      activityPeopleByRoom.set(event.roomId, new Set(event.participants));
      continue;
    }

    if (event.type === 'ActivityEnded') {
      activityPeopleByRoom.delete(event.roomId);
      continue;
    }

    if (event.type === 'AlertCreated') {
      alertSeverityByRoom.set(event.roomId, strongestAlertSeverity(alertSeverityByRoom.get(event.roomId), event.severity));
      continue;
    }

    if (
      event.type !== 'DeviceStateChanged' ||
      event.reason?.startsWith('ambient:') ||
      event.reason?.startsWith('sensor:camera:')
    ) {
      continue;
    }

    const ruleId = event.reason?.startsWith('rule:') ? event.reason.slice('rule:'.length) : '';
    const automation = ruleId ? automations.get(ruleId) : undefined;
    const nextState = formatStateAction(event.state);
    const observedPeople = uniqueSorted([
      ...[...(activityPeopleByRoom.get(event.roomId) ?? new Set<string>())],
      ...[...(peopleByRoom.get(event.roomId) ?? new Set<string>())]
    ].map(formatPerson));
    const people = observedPeople.length > 0 ? observedPeople : ruleId || alertSeverityByRoom.has(event.roomId) ? humanMemberLabels : [];
    const ruleName = ruleId ? formatRuleName(ruleId) : inferRuleName(event.reason ?? '');
    const previousState = previousStateByDevice.get(event.deviceId) ?? 'previous state not observed';
    const alertSeverity = alertSeverityByRoom.get(event.roomId) ?? null;
    records.push({
      id: event.id,
      time: event.simTime,
      scenarioId: event.scenarioId,
      deviceId: event.deviceId,
      deviceName: formatDeviceName(event.deviceId),
      roomName: formatRoomName(event.roomId),
      people,
      alertSeverity,
      actor: ruleId ? 'Automation rule' : people[0] ?? 'Household routine',
      trigger: automation?.explanation ?? formatReason(event.reason ?? 'unknown'),
      ruleName,
      action: nextState,
      previousState,
      nextState,
      payload: {
        eventId: event.id,
        scenarioId: event.scenarioId,
        deviceId: event.deviceId,
        deviceName: formatDeviceName(event.deviceId),
        roomName: formatRoomName(event.roomId),
        people,
        alertSeverity,
        ruleName,
        previousState,
        nextState,
        reason: event.reason ?? null
      },
      reason: event.reason ?? 'unknown'
    });
    previousStateByDevice.set(event.deviceId, nextState);
  }

  return records.slice(-30).reverse();
}

function createControlRecordFilters(records: ControlRecord[]): ControlRecordFilters {
  return {
    rooms: uniqueSorted(records.map((record) => record.roomName)),
    rules: uniqueSorted(records.map((record) => record.ruleName)),
    devices: uniqueSorted(records.map((record) => record.deviceName)),
    people: uniqueSorted(records.flatMap((record) => record.people)),
    scenarios: uniqueSorted(records.map((record) => record.scenarioId)),
    alertSeverities: uniqueSorted(records.flatMap((record) => record.alertSeverity ? [record.alertSeverity] : [])) as AlertState['severity'][],
    timeRange: records.length > 0
      ? {
          from: records[records.length - 1].time,
          to: records[0].time
        }
      : null
  };
}

function createAutomationExplanations(events: TwinEvent[], controlRecords: ControlRecord[]): AutomationExplanation[] {
  return events
    .filter((event) => event.type === 'AutomationTriggered')
    .slice(-12)
    .reverse()
    .map((event) => {
      const ruleName = formatRuleName(event.ruleId);
      const actions = event.actions.map(formatAction);
      const matchedFacts = [formatMatchedFact(event.reason ?? event.ruleId)];
      const relatedRecords = controlRecords
        .filter((record) => record.reason === `rule:${event.ruleId}`)
        .reverse();
      return {
        id: event.id,
        time: event.simTime,
        ruleId: event.ruleId,
        ruleName,
        explanation: event.explanation,
        matchedFacts,
        actions,
        decisionChain: [
          { label: 'Human activity', value: inferHumanActivity(event.ruleId) },
          { label: 'Sensor observation', value: matchedFacts.join(', ') },
          { label: 'Rule matched', value: ruleName },
          { label: 'Device command', value: actions.join(', ') },
          { label: 'Resulting state', value: formatResultingState(relatedRecords) }
        ]
      };
    });
}

function createAlertWorkflows(snapshot: TwinSnapshot, events: TwinEvent[]): AlertWorkflow[] {
  const automationActions = new Set(events
    .filter((event) => event.type === 'AutomationTriggered')
    .flatMap((event) => event.actions.map(formatAction)));

  return Object.values(snapshot.alerts)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((alert) => {
      const action = formatAction(alert.recommendedAction);
      const responded = automationActions.has(action);
      return {
        alertId: alert.id,
        title: alert.message,
        roomName: formatRoomName(alert.roomId),
        severity: alert.severity,
        lifecycleStatus: getAlertLifecycleStatus(alert),
        status: formatAlertWorkflowStatus(alert, responded),
        recommendedAction: formatAction(alert.recommendedAction),
        evidence: createAlertEvidence(alert, events),
        actions: createAlertWorkflowActions(alert),
        steps: [
          'Alert detected',
          responded ? 'Automation response started' : 'Awaiting automation or operator review',
          responded ? `Device action executed: ${action}` : `Recommended action: ${action}`,
          `User notification prepared: ${action}`,
          formatAlertWorkflowFinalStep(alert)
        ]
      };
    });
}

function createAlertWorkflowActions(alert: AlertState): AlertWorkflowAction[] {
  const status = getAlertLifecycleStatus(alert);
  const statusEndpoint = `/api/alerts/${encodeURIComponent(alert.id)}/status`;
  return [
    {
      kind: 'acknowledge',
      label: status === 'acknowledged' ? 'Acknowledged' : 'Confirm received',
      endpoint: statusEndpoint,
      status: 'acknowledged',
      highRisk: false
    },
    { kind: 'remind', label: 'Remind later', highRisk: false },
    {
      kind: 'ignore',
      label: 'Ignore once',
      endpoint: statusEndpoint,
      status: 'ignored',
      highRisk: alert.severity === 'high'
    },
    { kind: 'evidence', label: 'View evidence', highRisk: false },
    { kind: 'replay', label: 'View 3D replay', highRisk: false },
    {
      kind: 'resolve',
      label: status === 'resolved' ? 'Resolved' : 'Mark resolved',
      endpoint: statusEndpoint,
      status: 'resolved',
      highRisk: false
    }
  ];
}

function createAlertEvidence(alert: AlertState, events: TwinEvent[]): string[] {
  const sourceEntities = alert.sourceEntityIds ?? [];
  const entityEvidence = sourceEntities.map((entityId) => `${formatAffectedEntity(entityId)} reported the condition`);
  const eventEvidence = events
    .filter((event): event is Extract<TwinEvent, { type: 'DeviceStateChanged' }> => (
      event.type === 'DeviceStateChanged' &&
      (sourceEntities.includes(event.deviceId) || event.roomId === alert.roomId)
    ))
    .slice(-3)
    .map((event) => `${formatDeviceName(event.deviceId)} state: ${formatStateAction(event.state)}`);
  return [...entityEvidence, ...eventEvidence].slice(0, 4);
}

function activeAlerts(snapshot: TwinSnapshot): AlertState[] {
  return Object.values(snapshot.alerts).filter(isUnresolvedAlert);
}

function isUnresolvedAlert(alert: AlertState): boolean {
  const status = getAlertLifecycleStatus(alert);
  return status === 'active' || status === 'acknowledged';
}

function formatAlertWorkflowStatus(alert: AlertState, responded: boolean): string {
  const status = getAlertLifecycleStatus(alert);
  if (status === 'resolved') return 'Resolved';
  if (status === 'acknowledged') return 'Acknowledged';
  if (status === 'ignored') return 'Ignored';
  return responded ? 'Automation responded' : 'Needs attention';
}

function formatAlertWorkflowFinalStep(alert: AlertState): string {
  const status = getAlertLifecycleStatus(alert);
  if (status === 'resolved') return 'Status: resolved';
  if (status === 'acknowledged') return 'Status: acknowledged';
  if (status === 'ignored') return 'Status: ignored';
  return 'Status: waiting for manual confirmation';
}

function getAlertLifecycleStatus(alert: AlertState): AlertLifecycleStatus {
  return alert.status ?? 'active';
}

function insightCategory(metric: string, deviceType: string | undefined): InsightCard['category'] {
  if (metric.includes('flow') || metric.includes('total') || deviceType?.includes('water')) return 'water';
  if (metric.includes('power')) return 'energy';
  if (metric.includes('co2') || metric.includes('pm25') || metric.includes('temperature') || metric.includes('humidity')) return 'health_comfort';
  return 'device_health';
}

function insightPriority(status: InsightCard['status'], category: InsightCard['category']): number {
  const statusScore = status === 'alert' ? 82 : status === 'watch' ? 58 : 24;
  const categoryBoost: Record<InsightCard['category'], number> = {
    device_health: 8,
    health_comfort: 6,
    water: 5,
    energy: 2
  };
  return statusScore + categoryBoost[category];
}

function airQualityBoost(metric: string): number {
  return metric === 'co2' || metric === 'pm25' ? 12 : 0;
}

function insightTitle(metric: string, roomId: RoomId | undefined): string {
  const room = roomId ? formatRoomName(roomId) : 'Home';
  if (metric === 'co2' || metric === 'pm25') return `${room} air quality trend`;
  if (metric.includes('temperature') || metric.includes('humidity')) return `${room} comfort trend`;
  if (metric.includes('flow') || metric.includes('total')) return `${room} water use trend`;
  return `${room} device telemetry trend`;
}

function recommendedTelemetryAction(id: string): string {
  const metric = id.split(':')[1] ?? '';
  if (metric === 'co2' || metric === 'pm25') return 'Ventilate the room for 10 minutes';
  if (metric === 'flow_l_min') return 'Inspect water flow and close the valve if needed';
  if (metric === 'temperature_c') return 'Adjust climate target or airflow';
  if (metric === 'humidity_percent') return 'Check ventilation and moisture sources';
  return 'Review the related device';
}

function expectedTelemetryEffect(metric: string): string {
  if (metric === 'co2' || metric === 'pm25') return 'Air quality should return toward the preferred range.';
  if (metric === 'flow_l_min') return 'Unexpected water usage should stop or be explained.';
  if (metric === 'temperature_c') return 'Room comfort should stabilize over the next cycle.';
  return 'The reading should move back toward its normal range.';
}

function createDemoSpotlight(
  snapshot: TwinSnapshot,
  controlRecords: ControlRecord[],
  automationExplanations: AutomationExplanation[],
  alertWorkflows: AlertWorkflow[],
  priorityQueue: PriorityItem[]
): DemoSpotlight | null {
  const primaryAlert = priorityQueue.find((item) => item.kind === 'alert' && item.priority >= 72);
  if (primaryAlert?.sourceId) {
    const activeAlert = snapshot.alerts[primaryAlert.sourceId];
    const workflow = alertWorkflows.find((candidate) => candidate.alertId === primaryAlert.sourceId);
    if (activeAlert) {
      return {
        id: `alert:${activeAlert.id}`,
        scenarioId: snapshot.scenarioId,
        kind: 'alert',
        headline: workflow?.title ?? activeAlert.message,
        summary: activeAlert.recommendedAction,
        roomId: activeAlert.roomId,
        roomName: formatRoomName(activeAlert.roomId),
        pauseMs: 2000
      };
    }
  }

  const latestAutomation = automationExplanations[0];
  if (latestAutomation) {
    const record = controlRecords.find((candidate) => candidate.reason === `rule:${latestAutomation.ruleId}`);
    const roomId = record ? devicesById.get(record.deviceId)?.roomId : inferAutomationRoom(latestAutomation.ruleId);
    return {
      id: `automation:${latestAutomation.id}`,
      scenarioId: snapshot.scenarioId,
      kind: 'automation',
      headline: latestAutomation.ruleName,
      summary: latestAutomation.explanation,
      roomId: roomId ?? firstOccupiedRoom(snapshot),
      roomName: formatRoomName(roomId ?? firstOccupiedRoom(snapshot)),
      pauseMs: 2000,
      automationId: latestAutomation.id,
      controlRecordId: record?.id,
      focusDeviceId: record?.deviceId,
      replayRuleId: latestAutomation.ruleId
    };
  }

  const activeAlert = activeAlerts(snapshot).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (activeAlert) {
    const workflow = alertWorkflows.find((candidate) => candidate.alertId === activeAlert.id);
    return {
      id: `alert:${activeAlert.id}`,
      scenarioId: snapshot.scenarioId,
      kind: 'alert',
      headline: workflow?.title ?? activeAlert.message,
      summary: activeAlert.recommendedAction,
      roomId: activeAlert.roomId,
      roomName: formatRoomName(activeAlert.roomId),
      pauseMs: 2000
    };
  }

  const roomId = firstOccupiedRoom(snapshot);
  const activity = createHouseholdActivity(snapshot);
  return {
    id: `activity:${snapshot.scenarioId}:${roomId}`,
    scenarioId: snapshot.scenarioId,
    kind: 'activity',
    headline: activity.title,
    summary: activity.summary,
    roomId,
    roomName: formatRoomName(roomId),
    pauseMs: 0
  };
}

function enrichTelemetrySeries(
  series: { id: string; label: string; points: number[] },
  automationsByRoom: Map<RoomId, string>
): DashboardModel['telemetrySeries'][number] {
  const currentValue = series.points.at(-1) ?? 0;
  const metric = series.id.split(':')[1] ?? '';
  const deviceId = series.id.split(':')[0] ?? '';
  const device = devicesById.get(deviceId);
  const unit = telemetryUnit(metric);
  const normalRange = telemetryNormalRange(metric);
  const thresholdStatus = currentValue > normalRange[1] * 1.25
    ? 'alert'
    : currentValue > normalRange[1]
      ? 'watch'
      : 'normal';
  return {
    ...series,
    currentValue,
    unit,
    normalRange,
    thresholdStatus,
    insight: createTelemetryInsight(series.id, currentValue, unit, thresholdStatus),
    relatedAutomation: device ? automationsByRoom.get(device.roomId) ?? null : null
  };
}

function formatPerson(personId: string): string {
  return personLabels[personId] ?? personId.replaceAll('_', ' ');
}

function formatBehaviorText(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatBehaviorTarget(target: string): string {
  const device = devicesById.get(target);
  if (device) {
    return device.name;
  }
  if (target === 'away') {
    return 'Away';
  }
  if (roomsById.has(target as RoomId)) {
    return formatRoomName(target as RoomId);
  }
  return formatBehaviorText(target);
}

function behaviorPriority(personId: string, intent: string, routinePhase: string, energy: number): number {
  const intentPriority: Record<string, number> = {
    focused_remote_work: 90,
    finish_homework: 82,
    decompress_after_commute: 74,
    care_for_plants: 68,
    needs_check_in: 96,
    explore_home: 45,
    rest: 20
  };
  const phaseBoost = routinePhase === 'wellness_watch' ? 30 : routinePhase === 'workday' ? 12 : routinePhase === 'after_school' ? 10 : routinePhase === 'evening_return' ? 8 : 0;
  const personBoost = personId === 'pet_1' ? -18 : 0;
  return (intentPriority[intent] ?? 40) + phaseBoost + personBoost + Math.round(energy / 20);
}

function lifecycleRecommendedAction(deviceType: string): string {
  if (deviceType === 'washer') return 'move_laundry_to_dryer';
  return 'empty_dishwasher';
}

function lifecycleHeadline(displayName: string, deviceType: string): string {
  if (deviceType === 'washer') return `${displayName} needs unloading`;
  return `${displayName} needs unloading`;
}

function lifecyclePriority(deviceType: string): number {
  if (deviceType === 'washer') return 64;
  if (deviceType === 'dishwasher') return 62;
  return 50;
}

function formatRoomName(roomId: RoomId | 'away'): string {
  if (roomId === 'away') return 'Away';
  return roomsById.get(roomId)?.name ?? roomId.replaceAll('_', ' ');
}

function formatDeviceName(deviceId: string): string {
  return devicesById.get(deviceId)?.name ?? deviceId;
}

function formatActivity(value: string): string {
  return titleCase(value.replaceAll('_', ' '));
}

function formatReason(value: string): string {
  return value.split(':').map((part) => part.replaceAll('_', ' ')).join(': ');
}

function formatRuleName(ruleId: string): string {
  return sentenceCase(ruleId.replaceAll('_', ' '));
}

function formatAlertTitle(alertId: string): string {
  const titles: Record<string, string> = {
    fridge_left_open_001: 'Fridge door has remained open',
    network_offline_001: 'Home network is offline',
    senior_no_activity_001: 'Senior activity not detected',
    water_leak_001: 'Bathroom leak detected while home is sleeping',
    door_left_open_001: 'Entrance door has been left open'
  };
  return titles[alertId] ?? sentenceCase(alertId.replaceAll('_', ' '));
}

function formatAffectedEntity(entityId: string): string {
  const entities: Record<string, string> = {
    fridge_01: 'Kitchen Fridge',
    router_01: 'Home Router',
    senior_1: 'Senior resident',
    entrance_door_01: 'Entrance Door'
  };
  return entities[entityId] ?? formatDeviceName(entityId);
}

function formatAbnormalityKind(kind: string): string {
  const labels: Record<string, string> = {
    door_left_open: 'Door left open',
    fridge_left_open: 'Fridge door left open',
    network_offline: 'Network outage',
    senior_no_activity: 'Senior inactivity'
  };
  return labels[kind] ?? sentenceCase(kind.replaceAll('_', ' '));
}

function inferRuleName(reason: string): string {
  if (reason.startsWith('activity:')) return 'Household activity';
  if (reason.startsWith('routine:')) return 'Daily routine';
  if (reason.startsWith('ambient:')) return 'Ambient sensing';
  if (reason.startsWith('manual_injection:')) return 'Manual injection';
  return 'Device update';
}

function formatAction(action: string): string {
  const withoutPrefix = action.includes(':') ? action.split(':').join(' ') : action;
  return withoutPrefix.replaceAll('_', ' ');
}

function formatMatchedFact(reason: string): string {
  const facts: Record<string, string> = {
    'home_mode:sleeping': 'home mode is sleeping',
    kitchen_occupied_and_stove_power: 'kitchen is occupied and stove power is high',
    stove_power_without_kitchen_occupancy: 'stove power is high while kitchen is empty',
    'occupancy_count:0': 'human occupancy count is 0',
    'water_leak_sensor:true': 'water leak sensor is true',
    'habit:pet_1:garden': 'pet is in the garden sprinkler zone'
  };
  return facts[reason] ?? formatReason(reason);
}

function addPersonToRoom(peopleByRoom: Map<RoomId, Set<string>>, roomId: RoomId, personId: string): void {
  const people = peopleByRoom.get(roomId) ?? new Set<string>();
  people.add(personId);
  peopleByRoom.set(roomId, people);
}

function removePersonFromRooms(peopleByRoom: Map<RoomId, Set<string>>, personId: string): void {
  for (const people of peopleByRoom.values()) {
    people.delete(personId);
  }
}

function strongestAlertSeverity(
  current: AlertState['severity'] | undefined,
  next: AlertState['severity']
): AlertState['severity'] {
  const rank: Record<AlertState['severity'], number> = { info: 0, warning: 1, high: 2 };
  return current && rank[current] > rank[next] ? current : next;
}

function inferAutomationRoom(ruleId: string): RoomId | null {
  if (ruleId === 'cooking_ventilation') return 'kitchen';
  if (ruleId === 'stove_unattended_safety') return 'kitchen';
  if (ruleId === 'close_water_valve_on_leak') return 'bathroom';
  if (ruleId === 'sleep_mode') return 'living_room';
  if (ruleId === 'away_mode') return 'entrance';
  if (ruleId === 'pet_garden_sprinkler_pause') return 'garden';
  return null;
}

function firstOccupiedRoom(snapshot: TwinSnapshot): RoomId {
  return Object.values(snapshot.rooms).find((room) => room.occupancy)?.id ?? 'living_room';
}

function inferHumanActivity(ruleId: string): string {
  if (ruleId === 'close_water_valve_on_leak') return 'Sleeping household';
  if (ruleId === 'sleep_mode') return 'Household sleeping';
  if (ruleId === 'cooking_ventilation') return 'Cooking in kitchen';
  if (ruleId === 'stove_unattended_safety') return 'Kitchen empty';
  if (ruleId === 'away_mode') return 'Family away';
  if (ruleId === 'pet_garden_sprinkler_pause') return 'Pet garden activity';
  return 'Household activity';
}

function formatResultingState(records: ControlRecord[]): string {
  if (records.length === 0) {
    return 'No device state change recorded';
  }
  return records
    .map((record) => `${record.deviceName}: ${record.nextState}`)
    .join('; ');
}

function formatStateAction(state: Record<string, string | number | boolean | null>): string {
  return Object.entries(state)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function formatMetric(metric: string): string {
  const labels: Record<string, string> = {
    temperature_c: 'temperature',
    humidity_percent: 'humidity',
    pm25: 'PM2.5',
    co2: 'CO2',
    flow_l_min: 'water flow',
    total_l: 'water total',
    moisture_percent: 'soil moisture'
  };
  return labels[metric] ?? metric.replaceAll('_', ' ');
}

function telemetryUnit(metric: string): string {
  if (metric === 'temperature_c') return 'C';
  if (metric === 'humidity_percent' || metric === 'moisture_percent') return '%';
  if (metric === 'pm25') return 'ug/m3';
  if (metric === 'co2') return 'ppm';
  if (metric === 'flow_l_min') return 'L/min';
  if (metric === 'total_l') return 'L';
  return '';
}

function telemetryNormalRange(metric: string): [number, number] {
  if (metric === 'temperature_c') return [18, 28];
  if (metric === 'humidity_percent') return [35, 65];
  if (metric === 'pm25') return [0, 35];
  if (metric === 'co2') return [400, 900];
  if (metric === 'flow_l_min') return [0, 6];
  if (metric === 'total_l') return [0, 120];
  if (metric === 'moisture_percent') return [30, 65];
  return [0, 100];
}

function createTelemetryInsight(id: string, currentValue: number, unit: string, status: 'normal' | 'watch' | 'alert'): string {
  const [deviceId, metric] = id.split(':');
  const device = devicesById.get(deviceId ?? '');
  const deviceName = device ? formatRoomName(device.roomId) : formatDeviceName(deviceId ?? '');
  const metricName = formatMetric(metric ?? '');
  const state = status === 'normal' ? 'inside normal range' : status === 'watch' ? 'above the preferred range' : 'in alert range';
  return `${deviceName} ${metricName} is ${currentValue}${unit ? ` ${unit}` : ''}, ${state}.`;
}

function formatAlertKind(message: string): string {
  if (message.toLowerCase().includes('leak')) return 'leak';
  if (message.toLowerCase().includes('door')) return 'door';
  if (message.toLowerCase().includes('network')) return 'network';
  if (message.toLowerCase().includes('senior')) return 'wellness';
  return 'alert';
}

function inferNextAction(mode: TwinSnapshot['homeState']['mode']): string {
  if (mode === 'morning') return 'Watch morning routine and departure records';
  if (mode === 'away') return 'Monitor security and arrival events';
  if (mode === 'evening_home') return 'Watch dinner and family activity records';
  if (mode === 'sleeping') return 'Monitor safety and quiet-home automation';
  if (mode === 'alert') return 'Review alert response workflow';
  return 'Continue simulation';
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function sentenceCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1).toLowerCase()}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueRoomIds(values: RoomId[]): RoomId[] {
  return [...new Set(values)];
}

function minutesOfDay(isoTime: string): number {
  const date = new Date(isoTime);
  return date.getHours() * 60 + date.getMinutes();
}

function formatMinute(minute: number): string {
  const hour = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function ownerForAction(action: string): string {
  const normalized = action.replaceAll(' ', '_');
  if (normalized.includes('homework')) return 'Student';
  if (normalized.includes('senior') || normalized.includes('check_in')) return 'Senior family member';
  if (normalized.includes('router') || normalized.includes('network')) return 'Hybrid work adult';
  if (normalized.includes('laundry') || normalized.includes('dishwasher') || normalized.includes('fridge')) return 'Commuter adult';
  return 'Household';
}
