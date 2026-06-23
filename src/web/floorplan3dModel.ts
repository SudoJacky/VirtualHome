import type { DeviceState, PersonKind, RoomId, Severity, TwinEvent, TwinSnapshot } from '../shared/types';
import { evaluateDeviceHealthSignals, getDeviceCapability, isDeviceTypeAbnormal, isDeviceTypeActive, summarizeDeviceState, type DeviceHealthStatus, type DeviceRiskLevel, type DeviceVisualModel } from '../shared/deviceRegistry';
import { getDeviceSupportedCommands } from '../shared/deviceInstanceCapabilities';
import { devicePoints, getDeviceInstanceProfile, type DeviceInstanceGroup, type DeviceMount, type DevicePrivacyLevel } from './deviceInstanceLayout';
import { getRoomLayout, roomLayouts, type RoomLayout } from './floorplanLayout';

export type FloorplanAlertSeverity = 'info' | 'warning' | 'critical';
export type DeviceMarkerKind = 'sensor' | 'actuator' | 'appliance' | 'security' | 'lighting' | 'climate' | 'media' | 'mobile' | 'network';
export type DeviceAnimationHint = 'pulse' | 'glow' | 'open_close' | 'rotate' | 'patrol' | 'vibrate' | 'airflow' | 'scan' | 'waterflow' | 'none';
export type FloorplanDeviceCommandStatus = 'none' | 'requested' | 'sent' | 'acknowledged' | 'failed' | 'timed-out';
export type FloorplanDeviceOperability = 'controllable' | 'read_only' | 'offline';

export interface FloorplanPoint {
  x: number;
  z: number;
}

export interface PersonVisualStyle {
  form: 'human' | 'pet';
  bodyColor: string;
  accentColor: string;
  skinColor: string;
  height: number;
  width: number;
}

export interface Floorplan3DRoom extends RoomLayout {
  occupied: boolean;
  lit: boolean;
  temperatureC: number;
  humidityPercent: number;
  alertSeverity?: FloorplanAlertSeverity;
}

export interface Floorplan3DPerson {
  id: string;
  kind: PersonKind;
  roomId: RoomId;
  label: string;
  activity: string;
  recent: boolean;
  x: number;
  z: number;
  movementPath: FloorplanPoint[];
  movementSegments: FloorplanMovementSegment[];
  movementTrailVisible: boolean;
  visualStyle: PersonVisualStyle;
}

export interface FloorplanMovementSegment {
  fromRoomId: RoomId | 'away';
  toRoomId: RoomId | 'away';
  activity: string;
  startedAt: string;
  endedAt: string;
  travelMinutes: number;
  from: FloorplanPoint;
  to: FloorplanPoint;
  progress: number;
}

export interface Floorplan3DDevice {
  id: string;
  roomId: RoomId;
  label: string;
  displayName: string;
  instanceGroup: DeviceInstanceGroup;
  privacyLevel: DevicePrivacyLevel;
  riskLevel: DeviceRiskLevel;
  active: boolean;
  abnormal: boolean;
  markerKind: DeviceMarkerKind;
  animationHint: DeviceAnimationHint;
  visualModel: DeviceVisualModel;
  visualVariant: string | null;
  statusLabel: string;
  x: number;
  z: number;
  y: number;
  rotation: number;
  mount: DeviceMount;
  scale: number;
  commandStatus: FloorplanDeviceCommandStatus;
  commandReason: string | null;
  recentEventLabel: string | null;
  healthStatus: DeviceHealthStatus[];
  operability: FloorplanDeviceOperability;
  interactionHint: string;
}

export interface FloorplanAutomationLink {
  id: string;
  ruleId: string;
  label: string;
  roomId: RoomId;
  sourceDeviceId?: string;
  targetDeviceId?: string;
  severity: FloorplanAlertSeverity;
}

export type ReplayStepKind = 'precondition' | 'sensor' | 'automation' | 'command' | 'result';
export type ReplayDeviceState = Record<string, string | number | boolean | null>;

export interface FloorplanReplayStep {
  id: string;
  kind: ReplayStepKind;
  label: string;
  detail: string;
  roomId: RoomId;
  deviceId?: string;
  atSequence: number;
  stateSnapshot?: ReplayDeviceState;
  previousState?: ReplayDeviceState;
  nextState?: ReplayDeviceState;
  commandStatus?: FloorplanDeviceCommandStatus;
  commandReason?: string | null;
}

export type FloorplanReplayDeviceRole = 'source' | 'target' | 'related';
export type FloorplanReplayTimelinePhase = 'before' | 'after';

export interface FloorplanReplayDeviceTimelineEntry {
  id: string;
  atSequence: number;
  simTime: string;
  phase: FloorplanReplayTimelinePhase;
  state: ReplayDeviceState;
  commandStatus?: FloorplanDeviceCommandStatus;
  commandReason?: string | null;
}

export interface FloorplanReplayDeviceTimeline {
  deviceId: string;
  displayName: string;
  role: FloorplanReplayDeviceRole;
  entries: FloorplanReplayDeviceTimelineEntry[];
}

export interface FloorplanEventReplay {
  id: string;
  ruleId: string;
  title: string;
  roomId: RoomId;
  focusDeviceId?: string;
  sourceDeviceId?: string;
  targetDeviceId?: string;
  severity: FloorplanAlertSeverity;
  deviceTimelines: FloorplanReplayDeviceTimeline[];
  steps: FloorplanReplayStep[];
}

export interface Floorplan3DModel {
  rooms: Floorplan3DRoom[];
  people: Floorplan3DPerson[];
  devices: Floorplan3DDevice[];
  automationLinks: FloorplanAutomationLink[];
  eventReplays: FloorplanEventReplay[];
}

export type FloorplanDeviceDisplayMode = 'active' | 'all' | 'abnormal' | 'sensor' | 'actuator' | 'appliance' | 'security' | 'lighting' | 'climate' | 'media' | 'mobile' | 'network';

export function selectVisibleFloorplanDevices(
  devices: Floorplan3DDevice[],
  mode: FloorplanDeviceDisplayMode,
  selected: { type: 'device'; id: string } | { type: 'room'; id: RoomId } | null,
  replayFocusDeviceId: string | null = null
): Floorplan3DDevice[] {
  const selectedDeviceId = selected?.type === 'device' ? selected.id : null;
  return devices.filter((device) => (
    device.id === selectedDeviceId ||
    device.id === replayFocusDeviceId ||
    mode === 'all' ||
    mode === 'active' && (device.active || device.abnormal) ||
    mode === 'abnormal' && device.abnormal ||
    device.markerKind === mode
  ));
}

export function createFloorplan3DModel(snapshot: TwinSnapshot, events: TwinEvent[]): Floorplan3DModel {
  const alertSeverityByRoom = new Map<RoomId, FloorplanAlertSeverity>();
  for (const alert of Object.values(snapshot.alerts)) {
    alertSeverityByRoom.set(alert.roomId, strongestSeverity(alertSeverityByRoom.get(alert.roomId), mapSeverity(alert.severity)));
  }

  const recentlyMovedPeople = new Set(events
    .filter((event) => event.type === 'PersonMoved')
    .slice(-8)
    .map((event) => event.personId));
  const moveEventsByPerson = new Map<string, Array<Extract<TwinEvent, { type: 'PersonMoved' }>>>();
  for (const event of events) {
    if (event.type !== 'PersonMoved') {
      continue;
    }
    const personEvents = moveEventsByPerson.get(event.personId) ?? [];
    personEvents.push(event);
    moveEventsByPerson.set(event.personId, personEvents);
  }
  const latestMoveByPerson = new Map(events
    .filter((event) => event.type === 'PersonMoved')
    .map((event) => [event.personId, event]));
  const latestStateChangeByDevice = new Map<string, Extract<TwinEvent, { type: 'DeviceStateChanged' }>>();
  const latestSeenAtByDevice = new Map<string, string>();

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === 'DeviceStateChanged') {
      latestStateChangeByDevice.set(event.deviceId, event);
      latestSeenAtByDevice.set(event.deviceId, event.simTime);
    } else if (event.type === 'DeviceTelemetry') {
      latestSeenAtByDevice.set(event.deviceId, event.simTime);
    }
  }

  const rooms = roomLayouts.map((layout) => {
    const room = snapshot.rooms[layout.id];
    return {
      ...layout,
      occupied: room.occupancy,
      lit: room.lightsOn,
      temperatureC: room.temperatureC,
      humidityPercent: room.humidityPercent,
      alertSeverity: alertSeverityByRoom.get(layout.id)
    };
  });

  const people = Object.values(snapshot.people)
    .filter((person) => person.location !== 'away')
    .map((person, index) => {
      const roomId = person.location as RoomId;
      const latestMove = latestMoveByPerson.get(person.id);
      const anchor = personAnchor({
        personId: person.id,
        roomId,
        activity: person.activity,
        index,
        currentTime: snapshot.simClock.currentTime,
        latestMove
      });
      const wanderPath = createWanderMovementPath({
        personId: person.id,
        roomId,
        activity: person.activity,
        index,
        currentTime: snapshot.simClock.currentTime,
        anchor
      });
      const movedRecently = recentlyMovedPeople.has(person.id);
      const movementSegments = createMovementSegments(person.id, index, moveEventsByPerson.get(person.id) ?? [], snapshot.simClock.currentTime);
      return {
        id: person.id,
        kind: person.kind,
        roomId,
        label: getPersonLabel(person.id),
        activity: person.activity,
        recent: movedRecently || wanderPath.length >= 2,
        x: anchor.x,
        z: anchor.z,
        movementPath: movedRecently
          ? createMovementPath(person.id, roomId, anchor, index, latestMove)
          : wanderPath,
        movementSegments,
        movementTrailVisible: movementSegments.some((segment) => segment.travelMinutes > 0),
        visualStyle: getPersonVisualStyle(person.id, person.kind)
      };
    });

  const devices = Object.values(snapshot.devices).map((device) => {
    const point = devicePoints.find((candidate) => candidate.deviceId === device.id);
    const capability = getDeviceCapability(device.type);
    const active = isDeviceTypeActive(device.type, device.state);
    const latestStateChange = latestStateChangeByDevice.get(device.id);
    const lastSeenAt = latestSeenAtByDevice.get(device.id) ?? snapshot.simClock.currentTime;
    const operability = deviceOperability(device, getDeviceSupportedCommands(device.id, device.type));
    const instanceProfile = getDeviceInstanceProfile(device.id);
    return {
      id: device.id,
      roomId: device.roomId,
      label: instanceProfile?.shortLabel ?? capability.shortLabel,
      displayName: instanceProfile?.displayName ?? capability.displayName,
      instanceGroup: instanceProfile?.group ?? 'living_comfort',
      privacyLevel: instanceProfile?.privacyLevel ?? 'household',
      riskLevel: instanceProfile?.riskOverride ?? capability.riskLevel,
      active,
      abnormal: active && isDeviceTypeAbnormal(device.type, device.state),
      markerKind: capability.markerKind as DeviceMarkerKind,
      animationHint: capability.animationHint as DeviceAnimationHint,
      visualModel: capability.visualModel,
      visualVariant: point?.visualVariant ?? null,
      statusLabel: summarizeDeviceState(device.type, device.state),
      x: point?.x ?? getRoomLayout(device.roomId).x,
      z: point?.z ?? getRoomLayout(device.roomId).z,
      y: point?.y ?? defaultDeviceY(point?.mount),
      rotation: point?.rotation ?? 0,
      mount: point?.mount ?? 'floor',
      scale: point?.scale ?? capability.visualScale,
      commandStatus: latestStateChange ? commandStatusForStateChange(latestStateChange) : 'none',
      commandReason: latestStateChange?.reason ?? null,
      recentEventLabel: latestStateChange ? recentEventLabelForStateChange(latestStateChange) : null,
      healthStatus: evaluateDeviceHealthSignals(capability.healthSignals, device.state, lastSeenAt, snapshot.simClock.currentTime),
      operability,
      interactionHint: interactionHintForOperability(operability)
    };
  });

  const automationLinks = createAutomationLinks(snapshot, events, alertSeverityByRoom);

  return {
    rooms,
    people,
    devices,
    automationLinks,
    eventReplays: createEventReplays(snapshot, events, automationLinks)
  };
}

function commandStatusForStateChange(event: Extract<TwinEvent, { type: 'DeviceStateChanged' }>): FloorplanDeviceCommandStatus {
  if (event.reason?.startsWith('abnormality:')) return 'failed';
  return 'acknowledged';
}

function recentEventLabelForStateChange(event: Extract<TwinEvent, { type: 'DeviceStateChanged' }>): string {
  return (event.reason ?? event.type)
    .replaceAll(':', ' ')
    .replaceAll('_', ' ');
}

function deviceOperability(device: DeviceState, supportedCommands: string[]): FloorplanDeviceOperability {
  if (device.state.online === false) return 'offline';
  if (supportedCommands.length === 0) return 'read_only';
  return 'controllable';
}

function interactionHintForOperability(operability: FloorplanDeviceOperability): string {
  if (operability === 'offline') {
    return 'Device is offline; controls are disabled until connectivity recovers.';
  }
  if (operability === 'read_only') {
    return 'Read-only sensor; inspect readings and health instead of direct controls.';
  }
  return 'Ready for device controls.';
}

function defaultDeviceY(mount: DeviceMount | undefined): number {
  if (mount === 'ceiling') return 0.62;
  if (mount === 'wall') return 0.45;
  if (mount === 'counter') return 0.24;
  if (mount === 'pipe') return 0.18;
  if (mount === 'outdoor') return 0.12;
  return 0.32;
}

function createMovementPath(
  personId: string,
  roomId: RoomId,
  anchor: FloorplanPoint,
  index: number,
  latestMove: Extract<TwinEvent, { type: 'PersonMoved' }> | undefined
): FloorplanPoint[] {
  if (!latestMove || latestMove.to !== roomId) {
    return [anchor];
  }

  const previous = latestMove.from === 'away'
    ? roomEntryPoint(roomId)
    : offsetWithinRoom(latestMove.from, index, 0.2);

  return [
    previous,
    midpoint(previous, anchor),
    anchor
  ];
}

function createMovementSegments(
  personId: string,
  index: number,
  moves: Array<Extract<TwinEvent, { type: 'PersonMoved' }>>,
  currentTime: string
): FloorplanMovementSegment[] {
  const nowMs = new Date(currentTime).getTime();
  return moves
    .slice(-8)
    .map((move) => {
      const travelMinutes = Math.max(0, Number(move.travelMinutes ?? 0));
      const endedAt = move.simTime;
      const startedAt = shiftIsoMinutes(endedAt, -travelMinutes);
      const startMs = new Date(startedAt).getTime();
      const endMs = new Date(endedAt).getTime();
      const durationMs = Math.max(1, endMs - startMs);
      const progress = travelMinutes === 0
        ? 1
        : clamp((nowMs - startMs) / durationMs, 0, 1);
      return {
        fromRoomId: move.from,
        toRoomId: move.to,
        activity: move.activity,
        startedAt,
        endedAt,
        travelMinutes,
        from: pointForMovementRoom(personId, move.from, index, startedAt),
        to: pointForMovementRoom(personId, move.to, index, endedAt),
        progress: round(progress)
      };
    });
}

function pointForMovementRoom(personId: string, roomId: RoomId | 'away', index: number, time: string): FloorplanPoint {
  if (roomId === 'away') {
    return roomEntryPoint('entrance');
  }
  return roomWanderAnchor(personId, roomId, time, index % 2 === 0 ? 0 : -1);
}

function shiftIsoMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return formatShanghaiTime(date);
}

function personAnchor({
  personId,
  roomId,
  activity,
  index,
  currentTime,
  latestMove
}: {
  personId: string;
  roomId: RoomId;
  activity: string;
  index: number;
  currentTime: string;
  latestMove: Extract<TwinEvent, { type: 'PersonMoved' }> | undefined;
}): FloorplanPoint {
  const approachDeviceId = latestMove && latestMove.to === roomId
    ? approachDeviceIdFromEvent(latestMove)
    : null;
  if (approachDeviceId) {
    return approachPointForDevice(approachDeviceId, roomId, personId);
  }

  if (activity === 'sleeping') {
    return offsetWithinRoom(roomId, index, 0.26);
  }

  return roomWanderAnchor(personId, roomId, currentTime, 0);
}

function createWanderMovementPath({
  personId,
  roomId,
  activity,
  index,
  currentTime,
  anchor
}: {
  personId: string;
  roomId: RoomId;
  activity: string;
  index: number;
  currentTime: string;
  anchor: FloorplanPoint;
}): FloorplanPoint[] {
  if (activity === 'sleeping' || minutesSinceWanderBucketStart(currentTime) > 1) {
    return [anchor];
  }

  const previous = roomWanderAnchor(personId, roomId, currentTime, -1);
  if (distance(previous, anchor) < 0.04) {
    return [offsetWithinRoom(roomId, index, 0.26), anchor];
  }
  return [previous, midpoint(previous, anchor), anchor];
}

function approachDeviceIdFromEvent(event: Extract<TwinEvent, { type: 'PersonMoved' }>): string | null {
  const match = event.reason?.match(/^operator:approach_device:([^:]+):/);
  return match?.[1] ?? null;
}

function approachPointForDevice(deviceId: string, roomId: RoomId, personId: string): FloorplanPoint {
  const point = devicePoints.find((candidate) => candidate.deviceId === deviceId);
  if (!point) {
    return roomWanderAnchor(personId, roomId, '2026-06-17T00:00:00+08:00', 0);
  }

  const layout = getRoomLayout(roomId);
  const centerDirection = normalize2d(layout.x - point.x, layout.z - point.z);
  const fallback = angleDirection(hashUnit(`${personId}:${deviceId}:approach`) * Math.PI * 2);
  const direction = centerDirection ?? fallback;
  const distanceFromDevice = 0.46;
  return {
    x: clamp(point.x + direction.x * distanceFromDevice, layout.x - layout.width / 2 + 0.18, layout.x + layout.width / 2 - 0.18),
    z: clamp(point.z + direction.z * distanceFromDevice, layout.z - layout.depth / 2 + 0.18, layout.z + layout.depth / 2 - 0.18)
  };
}

function roomWanderAnchor(personId: string, roomId: RoomId, currentTime: string, bucketOffset: number): FloorplanPoint {
  const layout = getRoomLayout(roomId);
  const bucket = Math.max(0, wanderBucket(currentTime) + bucketOffset);
  const maxX = Math.max(0.08, layout.width / 2 - 0.36);
  const maxZ = Math.max(0.08, layout.depth / 2 - 0.36);
  return {
    x: layout.x + centeredHash(`${personId}:${roomId}:${bucket}:x`) * maxX,
    z: layout.z + centeredHash(`${personId}:${roomId}:${bucket}:z`) * maxZ
  };
}

function wanderBucket(currentTime: string): number {
  return Math.floor(minuteOfDay(currentTime) / 20);
}

function minutesSinceWanderBucketStart(currentTime: string): number {
  return minuteOfDay(currentTime) % 20;
}

function minuteOfDay(currentTime: string): number {
  const match = currentTime.match(/T(\d{2}):(\d{2})/);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function roomEntryPoint(roomId: RoomId): FloorplanPoint {
  const layout = getRoomLayout(roomId);
  return {
    x: layout.x - layout.width / 2 + 0.18,
    z: layout.z
  };
}

function midpoint(from: FloorplanPoint, to: FloorplanPoint): FloorplanPoint {
  return {
    x: (from.x + to.x) / 2,
    z: (from.z + to.z) / 2
  };
}

function distance(from: FloorplanPoint, to: FloorplanPoint): number {
  return Math.hypot(from.x - to.x, from.z - to.z);
}

function normalize2d(x: number, z: number): FloorplanPoint | null {
  const length = Math.hypot(x, z);
  if (length < 0.001) {
    return null;
  }
  return { x: x / length, z: z / length };
}

function angleDirection(angle: number): FloorplanPoint {
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatShanghaiTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const shanghaiDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shanghaiDate.getUTCFullYear()}-${pad(shanghaiDate.getUTCMonth() + 1)}-${pad(shanghaiDate.getUTCDate())}T${pad(shanghaiDate.getUTCHours())}:${pad(shanghaiDate.getUTCMinutes())}:${pad(shanghaiDate.getUTCSeconds())}+08:00`;
}

function centeredHash(input: string): number {
  return hashUnit(input) * 2 - 1;
}

function hashUnit(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function createAutomationLinks(
  snapshot: TwinSnapshot,
  events: TwinEvent[],
  alertSeverityByRoom: Map<RoomId, FloorplanAlertSeverity>
): FloorplanAutomationLink[] {
  return events
    .filter((event): event is Extract<TwinEvent, { type: 'AutomationTriggered' }> => event.type === 'AutomationTriggered')
    .slice(-6)
    .reverse()
    .map((event) => {
      const link = automationLinkForRule(event.ruleId);
      const roomId = link?.roomId ?? inferAutomationRoom(snapshot, events, event.sequence);
      return {
        id: event.id,
        ruleId: event.ruleId,
        label: event.explanation,
        roomId,
        sourceDeviceId: link?.sourceDeviceId,
        targetDeviceId: link?.targetDeviceId,
        severity: strongestSeverity(alertSeverityByRoom.get(roomId), link?.severity ?? 'info')
      };
    });
}

function automationLinkForRule(ruleId: string): Pick<FloorplanAutomationLink, 'roomId' | 'sourceDeviceId' | 'targetDeviceId' | 'severity'> | undefined {
  const links: Record<string, Pick<FloorplanAutomationLink, 'roomId' | 'sourceDeviceId' | 'targetDeviceId' | 'severity'>> = {
    close_water_valve_on_leak: {
      roomId: 'bathroom',
      sourceDeviceId: 'water_leak_01',
      targetDeviceId: 'water_valve_01',
      severity: 'critical'
    },
    cooking_ventilation: {
      roomId: 'kitchen',
      sourceDeviceId: 'pm25_01',
      targetDeviceId: 'range_hood_01',
      severity: 'warning'
    },
    fridge_left_open: {
      roomId: 'kitchen',
      sourceDeviceId: 'fridge_01',
      targetDeviceId: 'fridge_01',
      severity: 'warning'
    },
    sprinkler_on: {
      roomId: 'garden',
      sourceDeviceId: 'garden_soil_01',
      targetDeviceId: 'sprinkler_01',
      severity: 'info'
    },
    network_jitter: {
      roomId: 'study',
      sourceDeviceId: 'router_01',
      targetDeviceId: 'router_01',
      severity: 'warning'
    },
    door_left_open: {
      roomId: 'entrance',
      sourceDeviceId: 'doorbell_camera_01',
      targetDeviceId: 'door_lock_01',
      severity: 'warning'
    },
    network_offline: {
      roomId: 'study',
      sourceDeviceId: 'router_01',
      targetDeviceId: 'router_01',
      severity: 'warning'
    },
    senior_no_activity: {
      roomId: 'master_bedroom',
      sourceDeviceId: 'master_sleep_01',
      targetDeviceId: 'master_sleep_01',
      severity: 'warning'
    },
    child_homework_focus: {
      roomId: 'child_bedroom',
      sourceDeviceId: 'child_sleep_01',
      targetDeviceId: 'tv_01',
      severity: 'info'
    },
    remote_work_comfort: {
      roomId: 'study',
      sourceDeviceId: 'study_co2_01',
      targetDeviceId: 'router_01',
      severity: 'info'
    },
    family_dinner_readiness: {
      roomId: 'dining_room',
      sourceDeviceId: 'fridge_01',
      targetDeviceId: 'dining_light_01',
      severity: 'info'
    },
    senior_morning_support: {
      roomId: 'master_bedroom',
      sourceDeviceId: 'master_sleep_01',
      targetDeviceId: 'master_ac_01',
      severity: 'info'
    }
  };
  return links[ruleId];
}

function inferAutomationRoom(snapshot: TwinSnapshot, events: TwinEvent[], sequence: number): RoomId {
  const nearbyDeviceEvent = events
    .filter((event): event is Extract<TwinEvent, { type: 'DeviceStateChanged' }> => event.type === 'DeviceStateChanged')
    .find((event) => Math.abs(event.sequence - sequence) <= 2);
  return nearbyDeviceEvent?.roomId ?? Object.values(snapshot.rooms).find((room) => room.occupancy)?.id ?? 'living_room';
}

function createEventReplays(
  snapshot: TwinSnapshot,
  events: TwinEvent[],
  automationLinks: FloorplanAutomationLink[]
): FloorplanEventReplay[] {
  const deviceEventStates = createDeviceEventStateHistory(snapshot, events);
  const automationEvents = events
    .filter((event): event is Extract<TwinEvent, { type: 'AutomationTriggered' }> => event.type === 'AutomationTriggered')
    .slice(-5)
    .reverse();

  return automationEvents.map((automation) => {
    const link = automationLinks.find((candidate) => candidate.id === automation.id);
    const roomId = link?.roomId ?? inferAutomationRoom(snapshot, events, automation.sequence);
    const relatedSensor = findNearbyDeviceEvent(events, automation.sequence, link?.sourceDeviceId, -8, 0);
    const relatedCommand = findNearbyDeviceEvent(events, automation.sequence, link?.targetDeviceId, -3, 3);
    const sourceDeviceId = link?.sourceDeviceId ?? relatedSensor?.deviceId;
    const targetDeviceId = link?.targetDeviceId ?? relatedCommand?.deviceId;

    return {
      id: automation.id,
      ruleId: automation.ruleId,
      title: automation.explanation,
      roomId,
      focusDeviceId: targetDeviceId ?? sourceDeviceId,
      sourceDeviceId,
      targetDeviceId,
      severity: link?.severity ?? 'info',
      deviceTimelines: createReplayDeviceTimelines(
        events,
        deviceEventStates,
        automation.sequence,
        sourceDeviceId,
        targetDeviceId
      ),
      steps: [
        {
          id: `${automation.id}:precondition`,
          kind: 'precondition',
          label: 'Replay starts',
          detail: 'Reconstructing the seconds before the automation from the event stream.',
          roomId,
          atSequence: Math.max(0, automation.sequence - 2)
        },
        {
          id: `${automation.id}:sensor`,
          kind: 'sensor',
          label: 'Sensor observation',
          detail: relatedSensor ? summarizeDeviceEvent(relatedSensor) : automation.explanation,
          roomId: relatedSensor?.roomId ?? roomId,
          deviceId: sourceDeviceId,
          atSequence: relatedSensor?.sequence ?? automation.sequence,
          ...replayStepState(relatedSensor, deviceEventStates)
        },
        {
          id: `${automation.id}:automation`,
          kind: 'automation',
          label: 'Rule matched',
          detail: automation.explanation,
          roomId,
          atSequence: automation.sequence
        },
        {
          id: `${automation.id}:command`,
          kind: 'command',
          label: 'Device command',
          detail: automation.actions.join(', '),
          roomId: relatedCommand?.roomId ?? roomId,
          deviceId: targetDeviceId,
          atSequence: relatedCommand?.sequence ?? automation.sequence,
          ...replayStepState(relatedCommand, deviceEventStates)
        },
        {
          id: `${automation.id}:result`,
          kind: 'result',
          label: 'Resulting state',
          detail: relatedCommand ? summarizeDeviceEvent(relatedCommand) : 'Awaiting resulting device state.',
          roomId: relatedCommand?.roomId ?? roomId,
          deviceId: targetDeviceId,
          atSequence: (relatedCommand?.sequence ?? automation.sequence) + 1,
          ...replayStepState(relatedCommand, deviceEventStates)
        }
      ]
    };
  });
}

interface ReplayDeviceEventState {
  previousState: ReplayDeviceState;
  nextState: ReplayDeviceState;
  stateSnapshot: ReplayDeviceState;
  commandStatus: FloorplanDeviceCommandStatus;
  commandReason: string | null;
}

function createDeviceEventStateHistory(
  snapshot: TwinSnapshot,
  events: TwinEvent[]
): Map<string, ReplayDeviceEventState> {
  const currentByDevice = new Map<string, ReplayDeviceState>();
  const statesByEvent = new Map<string, ReplayDeviceEventState>();

  for (const device of Object.values(snapshot.devices)) {
    currentByDevice.set(device.id, cloneReplayState(getDeviceCapability(device.type).defaultState));
  }

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type !== 'DeviceStateChanged') {
      continue;
    }
    const previousState = cloneReplayState(currentByDevice.get(event.deviceId) ?? {});
    const nextState = cloneReplayState(event.state);
    statesByEvent.set(event.id, {
      previousState,
      nextState,
      stateSnapshot: cloneReplayState(nextState),
      commandStatus: commandStatusForStateChange(event),
      commandReason: event.reason ?? null
    });
    currentByDevice.set(event.deviceId, nextState);
  }

  return statesByEvent;
}

function replayStepState(
  event: Extract<TwinEvent, { type: 'DeviceStateChanged' }> | undefined,
  deviceEventStates: Map<string, ReplayDeviceEventState>
): Partial<FloorplanReplayStep> {
  if (!event) {
    return {};
  }
  return deviceEventStates.get(event.id) ?? {};
}

function createReplayDeviceTimelines(
  events: TwinEvent[],
  deviceEventStates: Map<string, ReplayDeviceEventState>,
  automationSequence: number,
  sourceDeviceId: string | undefined,
  targetDeviceId: string | undefined
): FloorplanReplayDeviceTimeline[] {
  const deviceRoles = new Map<string, FloorplanReplayDeviceRole>();
  if (sourceDeviceId) {
    deviceRoles.set(sourceDeviceId, 'source');
  }
  if (targetDeviceId) {
    deviceRoles.set(targetDeviceId, targetDeviceId === sourceDeviceId ? 'related' : 'target');
  }

  return [...deviceRoles.entries()]
    .map(([deviceId, role]) => {
      const relatedEvents = events
        .filter((event): event is Extract<TwinEvent, { type: 'DeviceStateChanged' }> => (
          event.type === 'DeviceStateChanged' &&
          event.deviceId === deviceId &&
          event.sequence >= automationSequence - 8 &&
          event.sequence <= automationSequence + 3
        ))
        .sort((left, right) => left.sequence - right.sequence);
      const entries = relatedEvents.flatMap((event): FloorplanReplayDeviceTimelineEntry[] => {
        const state = deviceEventStates.get(event.id);
        if (!state) {
          return [];
        }
        return [
          {
            id: `${event.id}:before`,
            atSequence: event.sequence,
            simTime: event.simTime,
            phase: 'before',
            state: cloneReplayState(state.previousState)
          },
          {
            id: `${event.id}:after`,
            atSequence: event.sequence,
            simTime: event.simTime,
            phase: 'after',
            state: cloneReplayState(state.nextState),
            commandStatus: state.commandStatus,
            commandReason: state.commandReason
          }
        ];
      });
      return {
        deviceId,
        displayName: getDeviceInstanceProfile(deviceId)?.displayName ?? deviceId,
        role,
        entries
      };
    })
    .filter((timeline) => timeline.entries.length > 0);
}

function cloneReplayState(state: Record<string, string | number | boolean | null>): ReplayDeviceState {
  return structuredClone(state);
}

function findNearbyDeviceEvent(
  events: TwinEvent[],
  sequence: number,
  preferredDeviceId: string | undefined,
  minOffset: number,
  maxOffset: number
): Extract<TwinEvent, { type: 'DeviceStateChanged' }> | undefined {
  const candidates = events.filter((event): event is Extract<TwinEvent, { type: 'DeviceStateChanged' }> => (
    event.type === 'DeviceStateChanged' &&
    event.sequence >= sequence + minOffset &&
    event.sequence <= sequence + maxOffset
  ));
  return candidates.find((event) => event.deviceId === preferredDeviceId) ?? candidates[0];
}

function summarizeDeviceEvent(event: Extract<TwinEvent, { type: 'DeviceStateChanged' }>): string {
  return Object.entries(event.state)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function offsetWithinRoom(roomId: RoomId, index: number, spacing: number): { x: number; z: number } {
  const layout = getRoomLayout(roomId);
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: layout.x - spacing + column * spacing,
    z: layout.z + spacing + row * spacing
  };
}

function strongestSeverity(
  current: FloorplanAlertSeverity | undefined,
  next: FloorplanAlertSeverity
): FloorplanAlertSeverity {
  const rank: Record<FloorplanAlertSeverity, number> = { info: 0, warning: 1, critical: 2 };
  return current && rank[current] > rank[next] ? current : next;
}

function mapSeverity(severity: Severity): FloorplanAlertSeverity {
  if (severity === 'high') return 'critical';
  return severity;
}

function getPersonLabel(personId: string): string {
  const labels: Record<string, string> = {
    adult_1: 'A1',
    adult_2: 'A2',
    child_1: 'C',
    senior_1: 'S',
    pet_1: 'P'
  };
  return labels[personId] ?? personId.slice(0, 2).toUpperCase();
}

function getPersonVisualStyle(personId: string, kind: PersonKind): PersonVisualStyle {
  if (kind === 'pet') {
    return {
      form: 'pet',
      bodyColor: '#9a6a35',
      accentColor: '#6e4a24',
      skinColor: '#c99a62',
      height: 0.28,
      width: 0.34
    };
  }

  const styles: Record<string, PersonVisualStyle> = {
    adult_1: {
      form: 'human',
      bodyColor: '#245b7a',
      accentColor: '#d8b476',
      skinColor: '#c98f63',
      height: 0.78,
      width: 0.28
    },
    adult_2: {
      form: 'human',
      bodyColor: '#2f765f',
      accentColor: '#b7d7c3',
      skinColor: '#a97455',
      height: 0.76,
      width: 0.28
    },
    child_1: {
      form: 'human',
      bodyColor: '#7b5aa6',
      accentColor: '#f0d57a',
      skinColor: '#d4a174',
      height: 0.62,
      width: 0.23
    },
    senior_1: {
      form: 'human',
      bodyColor: '#6f7780',
      accentColor: '#e4e7dc',
      skinColor: '#b98b68',
      height: 0.72,
      width: 0.27
    }
  };

  return styles[personId] ?? {
    form: 'human',
    bodyColor: '#185a89',
    accentColor: '#d9e8f4',
    skinColor: '#c98f63',
    height: 0.74,
    width: 0.27
  };
}

