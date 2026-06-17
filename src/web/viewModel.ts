import type { AlertState, RoomId, TwinEvent, TwinSnapshot } from '../shared/types';

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
  recentEvents: DashboardEvent[];
  telemetrySeries: Array<{
    id: string;
    label: string;
    points: number[];
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

export function createDashboardModel(snapshot: TwinSnapshot, events: TwinEvent[]): DashboardModel {
  const occupiedRooms = Object.values(snapshot.rooms)
    .filter((room) => room.occupancy)
    .map((room) => room.name);
  const activeDeviceCount = Object.values(snapshot.devices)
    .filter((device) => Object.values(device.state).some((value) => value === true || value === 'on' || (typeof value === 'number' && value > 0)))
    .length;
  return {
    homeMode: snapshot.homeState.mode,
    simTime: snapshot.simClock.currentTime,
    occupancyCount: snapshot.homeState.occupancyCount,
    occupiedRooms,
    activeDeviceCount,
    alerts: Object.values(snapshot.alerts).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
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
  const byId = new Map<string, TwinEvent>();
  for (const event of [...current, ...incoming]) {
    byId.set(event.id, event);
  }
  return [...byId.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-limit);
}

function formatEvent(event: TwinEvent): DashboardEvent {
  if (event.type === 'AlertCreated') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${event.message} (${event.severity})` };
  }
  if (event.type === 'AutomationTriggered') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${event.ruleId}: ${event.explanation}` };
  }
  if (event.type === 'ActivityStarted') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${event.activityId} started in ${event.roomId}` };
  }
  if (event.type === 'PersonMoved') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${event.personId} moved to ${event.to} for ${event.activity}` };
  }
  if (event.type === 'DeviceStateChanged') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${event.deviceId} changed because ${event.reason ?? 'unknown'}` };
  }
  if (event.type === 'DeviceTelemetry') {
    return { id: event.id, time: event.simTime, type: event.type, label: `${event.deviceId} telemetry updated` };
  }
  return { id: event.id, time: event.simTime, type: event.type, label: event.type };
}

function createTelemetrySeries(events: TwinEvent[]): DashboardModel['telemetrySeries'] {
  const series = new Map<string, { id: string; label: string; points: number[] }>();
  for (const event of events) {
    if (event.type !== 'DeviceTelemetry') {
      continue;
    }
    for (const [metric, value] of Object.entries(event.measurements)) {
      if (typeof value !== 'number') {
        continue;
      }
      const id = `${event.deviceId}:${metric}`;
      const item = series.get(id) ?? { id, label: `${event.deviceId} ${metric}`, points: [] };
      item.points.push(value);
      series.set(id, item);
    }
  }
  return [...series.values()]
    .filter((item) => item.points.length > 1)
    .slice(0, 6);
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
      label: person.id.replace('_', ' '),
      activity: person.activity,
      slot: room.people.length,
      recent: recentlyMovedPeople.has(person.id)
    });
  }

  for (const device of Object.values(snapshot.devices)) {
    const room = rooms[device.roomId];
    const active = isDeviceActive(device.type, device.state);
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

function isDeviceActive(type: string, state: Record<string, string | number | boolean | null>): boolean {
  if (type === 'door_lock') return state.locked === false;
  if (type === 'light') return state.power === 'on';
  if (type === 'tv') return state.power === 'on';
  if (type === 'fridge') return state.doorOpen === true || Number(state.powerW ?? 0) > 100;
  if (type === 'stove') return Number(state.powerW ?? 0) > 0;
  if (type === 'range_hood') return state.power === 'on' || Number(state.speed ?? 0) > 0;
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
    living_light_01: 'Light',
    tv_01: 'TV',
    living_motion_01: 'Motion',
    kitchen_light_01: 'Light',
    kitchen_temp_01: 'Temp',
    fridge_01: 'Fridge',
    stove_01: 'Stove',
    range_hood_01: 'Hood',
    pm25_01: 'Air',
    dining_light_01: 'Light',
    master_sleep_01: 'Sleep',
    child_sleep_01: 'Sleep',
    study_co2_01: 'CO2',
    bathroom_water_01: 'Water',
    water_leak_01: 'Leak',
    water_valve_01: 'Valve',
    garden_soil_01: 'Soil',
    sprinkler_01: 'Sprinkler'
  };
  return labels[deviceId] ?? deviceId;
}
