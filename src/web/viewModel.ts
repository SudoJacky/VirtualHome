import { getCatalog } from '../sim/catalog';
import { isDeviceTypeActive } from '../shared/deviceRegistry';
import type { AlertLifecycleStatus, AlertState, RoomId, TwinEvent, TwinSnapshot } from '../shared/types';

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
  householdActivity: HouseholdActivity;
  controlRecords: ControlRecord[];
  controlRecordFilters: ControlRecordFilters;
  automationExplanations: AutomationExplanation[];
  alertWorkflows: AlertWorkflow[];
  scenarioCards: ScenarioCard[];
  demoSpotlight: DemoSpotlight | null;
  recentEvents: DashboardEvent[];
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
      active: boolean;
      slot: number;
    }>;
    activeDeviceCount: number;
  }>;
}

export interface HouseholdActivity {
  title: string;
  summary: string;
  roomName: string;
  participants: string[];
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
  steps: string[];
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
    expectedTimeline: 'Door-open injection creates warning and room focus.',
    expectedDeviceActions: ['Fridge state remains visible for inspection'],
    expectedAlerts: ['Fridge door has remained open'],
    recordsGenerated: 'Manual injection and appliance alert records.'
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
    expectedTimeline: 'Network-offline injection creates system warning.',
    expectedDeviceActions: ['Study and network-related state become the focus'],
    expectedAlerts: ['Home network is offline'],
    recordsGenerated: 'Connectivity alert and recovery recommendation records.'
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
  return {
    homeMode: snapshot.homeState.mode,
    simTime: snapshot.simClock.currentTime,
    occupancyCount: snapshot.homeState.occupancyCount,
    occupiedRooms,
    activeDeviceCount,
    alerts: activeAlerts(snapshot).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    householdActivity: createHouseholdActivity(snapshot),
    controlRecords,
    controlRecordFilters: createControlRecordFilters(controlRecords),
    automationExplanations,
    alertWorkflows,
    scenarioCards,
    demoSpotlight: createDemoSpotlight(snapshot, controlRecords, automationExplanations, alertWorkflows),
    recentEvents: events
      .filter((event) => event.type !== 'DeviceTelemetry')
      .slice(-20)
      .reverse()
      .map(formatEvent),
    telemetrySeries: createTelemetrySeries(events),
    floorplanRooms: createFloorplanRooms(snapshot, events)
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
      label: getDeviceLabel(device.id),
      active,
      slot: room.devices.length
    });
    if (active) {
      room.activeDeviceCount += 1;
    }
  }

  return rooms;
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

    if (event.type !== 'DeviceStateChanged' || event.reason?.startsWith('ambient:')) {
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

function activeAlerts(snapshot: TwinSnapshot): AlertState[] {
  return Object.values(snapshot.alerts).filter((alert) => getAlertLifecycleStatus(alert) === 'active');
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

function createDemoSpotlight(
  snapshot: TwinSnapshot,
  controlRecords: ControlRecord[],
  automationExplanations: AutomationExplanation[],
  alertWorkflows: AlertWorkflow[]
): DemoSpotlight | null {
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

  const activeAlert = Object.values(snapshot.alerts).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
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

function isDeviceActive(type: string, state: Record<string, string | number | boolean | null>): boolean {
  if (type === 'door_lock') return state.locked === false;
  if (type === 'light') return state.power === 'on';
  if (type === 'tv') return state.power === 'on';
  if (type === 'fridge') return state.doorOpen === true || Number(state.powerW ?? 0) > 100;
  if (type === 'stove') return Number(state.powerW ?? 0) > 0;
  if (type === 'range_hood') return state.power === 'on' || Number(state.speed ?? 0) > 0;
  if (type === 'doorbell_camera') return state.motion === true || state.ringing === true;
  if (type === 'package_sensor') return state.packagePresent === true;
  if (type === 'robot_vacuum') return state.status === 'cleaning' || state.status === 'stuck';
  if (type === 'curtain') return Number(state.positionPercent ?? 0) > 0;
  if (type === 'smoke_sensor') return state.smokeDetected === true || Number(state.density ?? 0) > 0;
  if (type === 'dishwasher') return state.status === 'running' || state.status === 'done' || Number(state.powerW ?? 0) > 0;
  if (type === 'air_conditioner') return state.power === 'on';
  if (type === 'router') return state.online !== true || Number(state.latencyMs ?? 0) > 100;
  if (type === 'washer') return state.status === 'running' || state.status === 'done' || Number(state.powerW ?? 0) > 0;
  if (type === 'security_camera') return state.motion === true || state.recording === true;
  if (type === 'water_flow_sensor') return Number(state.flowLMin ?? 0) > 0;
  if (type === 'water_leak_sensor') return state.leakDetected === true;
  if (type === 'water_valve') return state.valveOpen === true;
  if (type === 'sprinkler') return state.valveOpen === true;
  if (type === 'sleep_sensor') return state.inBed === true;
  if (type === 'motion_sensor') return state.motion === true;
  return false;
}

function getDeviceLabel(deviceId: string): string {
  const labels: Record<string, string> = {
    door_lock_01: 'Lock',
    entrance_motion_01: 'Motion',
    doorbell_camera_01: 'Doorbell',
    package_sensor_01: 'Package',
    living_light_01: 'Light',
    tv_01: 'TV',
    living_motion_01: 'Motion',
    robot_vacuum_01: 'Vacuum',
    living_curtain_01: 'Curtain',
    kitchen_light_01: 'Light',
    kitchen_temp_01: 'Temp',
    fridge_01: 'Fridge',
    stove_01: 'Stove',
    range_hood_01: 'Hood',
    pm25_01: 'Air',
    smoke_01: 'Smoke',
    dishwasher_01: 'Dish',
    dining_light_01: 'Light',
    master_sleep_01: 'Sleep',
    master_ac_01: 'AC',
    child_sleep_01: 'Sleep',
    study_co2_01: 'CO2',
    router_01: 'Router',
    bathroom_water_01: 'Water',
    water_leak_01: 'Leak',
    water_valve_01: 'Valve',
    washer_01: 'Washer',
    garden_soil_01: 'Soil',
    garden_camera_01: 'Camera',
    sprinkler_01: 'Sprinkler'
  };
  return labels[deviceId] ?? deviceId;
}

function formatPerson(personId: string): string {
  return personLabels[personId] ?? personId.replaceAll('_', ' ');
}

function formatRoomName(roomId: RoomId | 'away'): string {
  if (roomId === 'away') return 'Away';
  return roomsById.get(roomId)?.name ?? roomId.replaceAll('_', ' ');
}

function formatDeviceName(deviceId: string): string {
  return devicesById.get(deviceId)?.name ?? getDeviceLabel(deviceId);
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
