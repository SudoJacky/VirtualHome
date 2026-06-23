import { describe, expect, it } from 'vitest';
import { getCatalog } from '../src/sim/catalog';
import { createSimulator } from '../src/sim/engine';
import type { PersonState, RoomId, TwinSnapshot } from '../src/shared/types';
import { getDeviceCapability } from '../src/shared/deviceRegistry';
import { devicePoints } from '../src/web/deviceInstanceLayout';
import { createFloorplan3DModel, selectVisibleFloorplanDevices } from '../src/web/floorplan3dModel';
import { roomConnectionOpenings, roomLayouts, wallSegments } from '../src/web/floorplanLayout';

function addSeniorToSnapshot(snapshot: TwinSnapshot, location: RoomId | 'away', activity: string): PersonState {
  const senior: PersonState = {
    id: 'senior_1',
    kind: 'human',
    location,
    activity,
    behavior: {
      routinePhase: activity === 'sleeping' ? 'sleep' : 'wellness_watch',
      intent: activity === 'morning_rest' ? 'steady_routine' : 'rest',
      attentionTarget: location,
      energy: 44
    },
    confidence: 1,
    privacyMode: false
  };
  snapshot.people.senior_1 = senior;
  return senior;
}

describe('3D floorplan layout and model', () => {
  it('defines renderable layout metadata for every room and catalog device', () => {
    const catalog = getCatalog();
    const layoutRoomIds = new Set(roomLayouts.map((room) => room.id));
    const pointDeviceIds = new Set(devicePoints.map((point) => point.deviceId));

    expect([...layoutRoomIds].sort()).toEqual(catalog.rooms.map((room) => room.id).sort());
    expect([...pointDeviceIds].sort()).toEqual(catalog.devices.map((device) => device.id).sort());
    expect(roomLayouts.every((room) => room.width > 0 && room.depth > 0)).toBe(true);
    expect(roomLayouts.every((room) => room.materialKind && room.wallHeight > 0 && room.wallThickness > 0)).toBe(true);
  });

  it('maps snapshot people, active devices, and alerts onto stable 3D positions', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.rooms.find((room) => room.id === 'bathroom')?.alertSeverity).toBe('critical');
    expect(model.people.map((person) => person.id).sort()).toEqual(['adult_1', 'adult_2', 'child_1', 'pet_1']);
    expect(model.people.every((person) => Number.isFinite(person.x) && Number.isFinite(person.z))).toBe(true);
    expect(model.devices.some((device) => device.id === 'water_leak_01' && device.active && device.abnormal)).toBe(true);
    expect(model.devices.every((device) => Number.isFinite(device.x) && Number.isFinite(device.z))).toBe(true);
  });

  it('classifies device markers and animation hints for a richer 3D scene', () => {
    const simulator = createSimulator({ seed: 2026 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(360);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.devices.find((device) => device.id === 'package_sensor_01')).toMatchObject({
      markerKind: 'sensor',
      animationHint: 'pulse'
    });
    const robotVacuum = model.devices.find((device) => device.id === 'robot_vacuum_01');
    const robotVacuumCapability = getDeviceCapability('robot_vacuum');
    expect(robotVacuum?.markerKind).toBe(robotVacuumCapability.markerKind);
    expect(robotVacuum?.animationHint).toBe(robotVacuumCapability.animationHint);
    expect(model.devices.find((device) => device.id === 'washer_01')).toMatchObject({
      markerKind: 'appliance',
      animationHint: 'vibrate'
    });
    expect(model.devices.find((device) => device.id === 'doorbell_camera_01')).toMatchObject({
      markerKind: 'security',
      animationHint: 'scan'
    });
    expect(model.devices.every((device) => device.statusLabel.length > 0)).toBe(true);
  });

  it('maps first-batch devices to differentiated visual models and instance mounts', () => {
    const simulator = createSimulator({ seed: 2026 });
    simulator.startScenario('weekday_normal');

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.devices.find((device) => device.id === 'tv_01')).toMatchObject({
      visualModel: 'tv_screen',
      mount: 'wall',
      rotation: Math.PI
    });
    expect(model.devices.find((device) => device.id === 'fridge_01')).toMatchObject({
      visualModel: 'fridge_tower',
      mount: 'floor',
      scale: expect.any(Number)
    });
    expect(model.devices.find((device) => device.id === 'washer_01')).toMatchObject({
      visualModel: 'washer_drum',
      mount: 'floor'
    });
    expect(model.devices.find((device) => device.id === 'router_01')).toMatchObject({
      visualModel: 'router_antennas',
      mount: 'counter'
    });
    expect(model.devices.find((device) => device.id === 'doorbell_camera_01')).toMatchObject({
      visualModel: 'wall_camera',
      mount: 'wall',
      visualVariant: 'doorbell_slim'
    });
    expect(model.devices.find((device) => device.id === 'garden_camera_01')).toMatchObject({
      visualModel: 'wall_camera',
      mount: 'wall',
      visualVariant: 'outdoor_bullet'
    });
    expect(model.devices.find((device) => device.id === 'living_light_01')).toMatchObject({
      visualModel: 'light_disc',
      mount: 'ceiling'
    });
    expect(model.devices.find((device) => device.id === 'robot_vacuum_01')).toMatchObject({
      visualModel: 'robot_vacuum',
      mount: 'floor'
    });
    expect(model.devices.find((device) => device.id === 'water_valve_01')).toMatchObject({
      visualModel: 'water_valve_handle',
      mount: 'pipe'
    });
    expect(model.devices.find((device) => device.id === 'water_leak_01')).toMatchObject({
      visualModel: 'sensor_puck',
      mount: 'floor'
    });
    expect(model.devices.find((device) => device.id === 'sprinkler_01')).toMatchObject({
      visualModel: 'sprinkler_head',
      mount: 'outdoor'
    });
  });

  it('builds automation links for event-driven 3D highlights', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.automationLinks[0]).toMatchObject({
      ruleId: 'close_water_valve_on_leak',
      roomId: 'bathroom',
      sourceDeviceId: 'water_leak_01',
      targetDeviceId: 'water_valve_01',
      severity: 'critical'
    });
  });

  it('projects command lifecycle and health status onto 3D devices', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const router = model.devices.find((device) => device.id === 'router_01');

    expect(router).toMatchObject({
      commandStatus: 'failed',
      commandReason: 'abnormality:network_offline'
    });
    expect(router?.healthStatus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'connectivity',
        sourceField: 'online',
        status: 'alert',
        impact: 'automation_reliability'
      })
    ]));
  });

  it('projects recent device events for 3D hover previews', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.devices.find((device) => device.id === 'router_01')).toMatchObject({
      recentEventLabel: 'abnormality network offline'
    });
  });

  it('projects device operability hints for offline and read-only 3D devices', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.devices.find((device) => device.id === 'router_01')).toMatchObject({
      operability: 'offline',
      interactionHint: 'Device is offline; controls are disabled until connectivity recovers.'
    });
    expect(model.devices.find((device) => device.id === 'garden_soil_01')).toMatchObject({
      operability: 'read_only',
      interactionHint: 'Read-only sensor; inspect readings and health instead of direct controls.'
    });
    expect(model.devices.find((device) => device.id === 'living_light_01')).toMatchObject({
      operability: 'controllable',
      interactionHint: 'Ready for device controls.'
    });
  });

  it('projects device instance metadata into the 3D device model', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.devices.find((device) => device.id === 'doorbell_camera_01')).toMatchObject({
      displayName: 'Doorbell Camera',
      label: 'Doorbell',
      instanceGroup: 'entrance_security',
      privacyLevel: 'private'
    });
    expect(model.devices.find((device) => device.id === 'router_01')).toMatchObject({
      displayName: 'Home Router',
      instanceGroup: 'network_infrastructure',
      privacyLevel: 'household'
    });
    expect(model.devices.find((device) => device.id === 'water_valve_01')).toMatchObject({
      instanceGroup: 'bathroom_water',
      riskLevel: 'high'
    });
  });

  it('projects semantic device animation hints for water flow and open-close affordances', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.devices.find((device) => device.id === 'water_leak_01')?.animationHint).toBe('waterflow');
    expect(model.devices.find((device) => device.id === 'sprinkler_01')?.animationHint).toBe('waterflow');
    expect(model.devices.find((device) => device.id === 'water_valve_01')?.animationHint).toBe('open_close');
    expect(model.devices.find((device) => device.id === 'living_curtain_01')?.animationHint).toBe('open_close');
    expect(model.devices.find((device) => device.id === 'door_lock_01')?.animationHint).toBe('open_close');
    expect(model.devices.find((device) => device.id === 'fridge_01')?.animationHint).toBe('open_close');
  });

  it('builds replay scenes that explain sensor, rule, command, and result steps', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.eventReplays[0]).toMatchObject({
      ruleId: 'close_water_valve_on_leak',
      roomId: 'bathroom',
      focusDeviceId: 'water_valve_01',
      sourceDeviceId: 'water_leak_01',
      targetDeviceId: 'water_valve_01'
    });
    expect(model.eventReplays[0].steps.map((step) => step.kind)).toEqual([
      'precondition',
      'sensor',
      'automation',
      'command',
      'result'
    ]);
    expect(model.eventReplays[0].steps[1]).toMatchObject({
      deviceId: 'water_leak_01',
      roomId: 'bathroom'
    });
    expect(model.eventReplays[0].steps[3]).toMatchObject({
      deviceId: 'water_valve_01',
      roomId: 'bathroom'
    });
  });

  it('attaches device state snapshots and command lifecycle to replay steps', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const replay = model.eventReplays.find((item) => item.ruleId === 'close_water_valve_on_leak');
    const sensor = replay?.steps.find((step) => step.kind === 'sensor');
    const command = replay?.steps.find((step) => step.kind === 'command');
    const result = replay?.steps.find((step) => step.kind === 'result');

    expect(sensor).toMatchObject({
      deviceId: 'water_leak_01',
      previousState: { leakDetected: false },
      nextState: { leakDetected: true },
      stateSnapshot: { leakDetected: true },
      commandStatus: 'failed',
      commandReason: 'abnormality:night_water_leak'
    });
    expect(command).toMatchObject({
      deviceId: 'water_valve_01',
      previousState: { valveOpen: true },
      nextState: { valveOpen: false },
      stateSnapshot: { valveOpen: false },
      commandStatus: 'acknowledged',
      commandReason: 'rule:close_water_valve_on_leak'
    });
    expect(result).toMatchObject({
      deviceId: 'water_valve_01',
      stateSnapshot: { valveOpen: false },
      commandStatus: 'acknowledged'
    });
  });

  it('builds per-device state timelines for replay source and target devices', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const replay = model.eventReplays.find((item) => item.ruleId === 'close_water_valve_on_leak');
    const leakTimeline = replay?.deviceTimelines.find((timeline) => timeline.deviceId === 'water_leak_01');
    const valveTimeline = replay?.deviceTimelines.find((timeline) => timeline.deviceId === 'water_valve_01');

    expect(leakTimeline).toMatchObject({
      displayName: 'Bathroom Leak Sensor',
      role: 'source',
      entries: [
        expect.objectContaining({
          phase: 'before',
          state: { leakDetected: false }
        }),
        expect.objectContaining({
          phase: 'after',
          state: { leakDetected: true },
          commandStatus: 'failed',
          commandReason: 'abnormality:night_water_leak'
        })
      ]
    });
    expect(valveTimeline).toMatchObject({
      displayName: 'Main Water Valve',
      role: 'target',
      entries: [
        expect.objectContaining({
          phase: 'before',
          state: { valveOpen: true }
        }),
        expect.objectContaining({
          phase: 'after',
          state: { valveOpen: false },
          commandStatus: 'acknowledged',
          commandReason: 'rule:close_water_valve_on_leak'
        })
      ]
    });
  });

  it('links behavior-model rules into 3D replay focus devices', () => {
    const dinnerSimulator = createSimulator({ seed: 42 });
    dinnerSimulator.startScenario('weekday_normal');
    dinnerSimulator.advanceMinutes(765);
    const dinnerModel = createFloorplan3DModel(dinnerSimulator.getSnapshot(), dinnerSimulator.getEvents());

    const seniorSimulator = createSimulator({ seed: 42 });
    seniorSimulator.startScenario('weekday_normal');
    const seniorSnapshot = seniorSimulator.getSnapshot();
    addSeniorToSnapshot(seniorSnapshot, 'master_bedroom', 'morning_rest');
    seniorSimulator.restore(seniorSnapshot, seniorSimulator.getEvents());
    seniorSimulator.advanceMinutes(35);
    const seniorModel = createFloorplan3DModel(seniorSimulator.getSnapshot(), seniorSimulator.getEvents());
    const dinner = dinnerModel.eventReplays.find((replay) => replay.ruleId === 'family_dinner_readiness');
    const seniorSupport = seniorModel.eventReplays.find((replay) => replay.ruleId === 'senior_morning_support');

    expect(dinner).toMatchObject({
      roomId: 'dining_room',
      sourceDeviceId: 'fridge_01',
      targetDeviceId: 'dining_light_01',
      focusDeviceId: 'dining_light_01'
    });
    expect(seniorSupport).toMatchObject({
      roomId: 'master_bedroom',
      sourceDeviceId: 'master_sleep_01',
      targetDeviceId: 'master_ac_01',
      focusDeviceId: 'master_ac_01'
    });
  });

  it('links core abnormality and behavior rules into replay focus devices', () => {
    const abnormalitySimulator = createSimulator({ seed: 42 });
    const abnormalitySnapshot = abnormalitySimulator.getSnapshot();
    addSeniorToSnapshot(abnormalitySnapshot, 'master_bedroom', 'morning_rest');
    abnormalitySimulator.restore(abnormalitySnapshot, abnormalitySimulator.getEvents());
    abnormalitySimulator.injectAbnormality('door_left_open');
    abnormalitySimulator.injectAbnormality('network_offline');
    abnormalitySimulator.injectAbnormality('senior_no_activity');
    const abnormalityModel = createFloorplan3DModel(abnormalitySimulator.getSnapshot(), abnormalitySimulator.getEvents());

    expect(abnormalityModel.eventReplays.find((replay) => replay.ruleId === 'door_left_open')).toMatchObject({
      roomId: 'entrance',
      sourceDeviceId: 'doorbell_camera_01',
      targetDeviceId: 'door_lock_01',
      focusDeviceId: 'door_lock_01'
    });
    expect(abnormalityModel.eventReplays.find((replay) => replay.ruleId === 'network_offline')).toMatchObject({
      roomId: 'study',
      sourceDeviceId: 'router_01',
      targetDeviceId: 'router_01',
      focusDeviceId: 'router_01'
    });
    expect(abnormalityModel.eventReplays.find((replay) => replay.ruleId === 'senior_no_activity')).toMatchObject({
      roomId: 'master_bedroom',
      sourceDeviceId: 'master_sleep_01',
      targetDeviceId: 'master_sleep_01',
      focusDeviceId: 'master_sleep_01'
    });

    const homeworkSimulator = createSimulator({ seed: 42 });
    homeworkSimulator.startScenario('weekday_normal');
    homeworkSimulator.advanceMinutes(605);
    const homeworkModel = createFloorplan3DModel(homeworkSimulator.getSnapshot(), homeworkSimulator.getEvents());

    const remoteWorkSimulator = createSimulator({ seed: 42 });
    remoteWorkSimulator.startScenario('weekday_normal');
    remoteWorkSimulator.advanceMinutes(90);
    const remoteWorkModel = createFloorplan3DModel(remoteWorkSimulator.getSnapshot(), remoteWorkSimulator.getEvents());

    expect(homeworkModel.eventReplays.find((replay) => replay.ruleId === 'child_homework_focus')).toMatchObject({
      roomId: 'child_bedroom',
      sourceDeviceId: 'child_sleep_01',
      targetDeviceId: 'tv_01',
      focusDeviceId: 'tv_01'
    });
    expect(remoteWorkModel.eventReplays.find((replay) => replay.ruleId === 'remote_work_comfort')).toMatchObject({
      roomId: 'study',
      sourceDeviceId: 'study_co2_01',
      targetDeviceId: 'router_01',
      focusDeviceId: 'router_01'
    });
  });

  it('keeps recent pet movement animation without drawing an ambient trail', () => {
    const simulator = createSimulator({ seed: 314 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(14);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const pet = model.people.find((person) => person.id === 'pet_1');

    expect(pet).toMatchObject({
      recent: true,
      movementTrailVisible: false
    });
    expect(pet?.movementPath.length).toBeGreaterThanOrEqual(2);
    expect(pet?.movementSegments.length).toBeGreaterThan(0);
    expect(pet?.movementPath.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z))).toBe(true);
  });

  it('limits frequent pet movement segments to the latest route burst', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(120);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const pet = model.people.find((person) => person.id === 'pet_1');
    const latestPetMove = simulator.getEvents()
      .filter((event) => event.type === 'PersonMoved' && event.personId === 'pet_1')
      .at(-1);

    expect(latestPetMove).toBeDefined();
    expect(pet?.movementSegments.length).toBeGreaterThan(0);
    expect(pet?.movementSegments.length).toBeLessThanOrEqual(2);
    expect(new Set(pet?.movementSegments.map((segment) => segment.endedAt))).toEqual(new Set([latestPetMove!.simTime]));
    expect(pet?.movementTrailVisible).toBe(false);
  });

  it('shows the selected adult returning after a manual device command while preserving the movement path', () => {
    const simulator = createSimulator({ seed: 42 });
    const events = simulator.commandDevice('tv_01', 'set_input', 'Game') ?? [];

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const tv = model.devices.find((device) => device.id === 'tv_01');
    const operator = model.people.find((person) => person.id === 'adult_1');
    const approach = events.find((event) => event.type === 'PersonMoved' && event.reason === 'operator:approach_device:tv_01:set_input');
    const returned = events.find((event) => event.type === 'PersonMoved' && event.reason === 'operator:return_from_device:tv_01:set_input');

    expect(approach).toMatchObject({
      type: 'PersonMoved',
      personId: 'adult_1',
      to: 'living_room',
      activity: 'controlling_tv_01',
      reason: 'operator:approach_device:tv_01:set_input'
    });
    expect(returned).toMatchObject({
      type: 'PersonMoved',
      personId: 'adult_1',
      from: 'living_room',
      to: 'master_bedroom',
      activity: 'idle',
      reason: 'operator:return_from_device:tv_01:set_input'
    });
    expect(operator).toMatchObject({
      roomId: 'master_bedroom',
      activity: 'idle',
      recent: true,
      movementTrailVisible: true
    });
    expect(operator?.movementSegments.map((segment) => ({
      from: segment.fromRoomId,
      to: segment.toRoomId,
      activity: segment.activity,
      reason: segment.reason,
      travelMinutes: segment.travelMinutes,
      startedAt: segment.startedAt.slice(11, 16),
      endedAt: segment.endedAt.slice(11, 16)
    }))).toEqual([
      {
        from: 'living_room',
        to: 'master_bedroom',
        activity: 'idle',
        reason: 'operator:return_from_device:tv_01:set_input',
        travelMinutes: 1,
        startedAt: '00:01',
        endedAt: '00:02'
      }
    ]);
    expect(tv).toBeDefined();
    expect(operator).toBeDefined();
    expect(operator?.movementPath.length).toBeGreaterThanOrEqual(2);
    expect(operator?.movementPath.at(-1)).toEqual({ x: operator?.x, z: operator?.z });
  });

  it('keeps movement segment wall-clock times independent of host timezone', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const simulator = createSimulator({ seed: 42 });
      simulator.commandDevice('tv_01', 'set_input', 'Game');

      const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
      const operator = model.people.find((person) => person.id === 'adult_1');

      expect(operator?.movementSegments.map((segment) => ({
        startedAt: segment.startedAt.slice(11, 16),
        endedAt: segment.endedAt.slice(11, 16)
      }))).toEqual([
        { startedAt: '00:01', endedAt: '00:02' }
      ]);
    } finally {
      process.env.TZ = originalTimezone;
    }
  });

  it('uses low-frequency room wander anchors instead of changing position every few minutes', () => {
    const simulator = createSimulator({ seed: 42 });
    const snapshot = simulator.getSnapshot();
    const earlySnapshot = structuredClone(snapshot);
    const sameBucketSnapshot = structuredClone(snapshot);
    const nextBucketSnapshot = structuredClone(snapshot);
    earlySnapshot.simClock.currentTime = '2026-06-17T06:00:00+08:00';
    sameBucketSnapshot.simClock.currentTime = '2026-06-17T06:10:00+08:00';
    nextBucketSnapshot.simClock.currentTime = '2026-06-17T06:25:00+08:00';

    const early = createFloorplan3DModel(earlySnapshot, []).people.find((person) => person.id === 'adult_1');
    const sameBucket = createFloorplan3DModel(sameBucketSnapshot, []).people.find((person) => person.id === 'adult_1');
    const nextBucket = createFloorplan3DModel(nextBucketSnapshot, []).people.find((person) => person.id === 'adult_1');
    const room = roomLayouts.find((layout) => layout.id === early?.roomId);

    expect(early).toBeDefined();
    expect(sameBucket).toMatchObject({ x: early?.x, z: early?.z });
    expect(distance(early!, nextBucket!)).toBeGreaterThan(0.08);
    expect(room).toBeDefined();
    expect(nextBucket!.x).toBeGreaterThan(room!.x - room!.width / 2 + 0.18);
    expect(nextBucket!.x).toBeLessThan(room!.x + room!.width / 2 - 0.18);
    expect(nextBucket!.z).toBeGreaterThan(room!.z - room!.depth / 2 + 0.18);
    expect(nextBucket!.z).toBeLessThan(room!.z + room!.depth / 2 - 0.18);
  });

  it('adds differentiated visual styles for humans and pets', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const humans = model.people.filter((person) => person.kind === 'human');
    const pet = model.people.find((person) => person.kind === 'pet');

    expect(humans).toHaveLength(3);
    expect(new Set(humans.map((person) => person.visualStyle.bodyColor)).size).toBeGreaterThan(2);
    expect(humans.every((person) => person.visualStyle.height >= 0.62)).toBe(true);
    expect(pet?.visualStyle).toMatchObject({
      bodyColor: '#9a6a35',
      height: 0.28,
      form: 'pet'
    });
  });

  it('defines a connected home shell with visible room openings', () => {
    const layoutRoomIds = new Set(roomLayouts.map((room) => room.id));

    expect(wallSegments.filter((segment) => segment.kind === 'exterior').length).toBeGreaterThanOrEqual(4);
    expect(wallSegments.some((segment) => segment.kind === 'interior')).toBe(true);
    expect(roomConnectionOpenings).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'living_room', to: 'kitchen', kind: 'open-plan' }),
      expect.objectContaining({ from: 'living_room', to: 'dining_room', kind: 'open-plan' }),
      expect.objectContaining({ from: 'living_room', to: 'garden', kind: 'wide-opening' })
    ]));
    expect(roomConnectionOpenings.every((opening) => layoutRoomIds.has(opening.from) && layoutRoomIds.has(opening.to))).toBe(true);
    expect(roomConnectionOpenings.every((opening) => opening.width > 0 && opening.depth > 0)).toBe(true);
  });

  it('supports task-oriented 3D device display modes', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(selectVisibleFloorplanDevices(model.devices, 'active', null).every((device) => device.active || device.abnormal)).toBe(true);
    expect(selectVisibleFloorplanDevices(model.devices, 'all', null)).toHaveLength(model.devices.length);
    expect(selectVisibleFloorplanDevices(model.devices, 'abnormal', null).map((device) => device.id)).toContain('router_01');
    expect(selectVisibleFloorplanDevices(model.devices, 'security', null).every((device) => device.markerKind === 'security')).toBe(true);
    expect(selectVisibleFloorplanDevices(model.devices, 'network', null).map((device) => device.id)).toEqual(['router_01']);
    expect(selectVisibleFloorplanDevices(model.devices, 'media', null).map((device) => device.id)).toEqual(['tv_01']);
    expect(selectVisibleFloorplanDevices(model.devices, 'active', { type: 'device', id: 'tv_01' }).map((device) => device.id)).toContain('tv_01');
  });

  it('keeps replay-focused devices visible even when display mode filters them out', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const visibleDeviceIds = selectVisibleFloorplanDevices(model.devices, 'abnormal', null, 'tv_01').map((device) => device.id);

    expect(model.devices.find((device) => device.id === 'tv_01')?.abnormal).toBe(false);
    expect(visibleDeviceIds).toContain('tv_01');
  });
});

function distance(
  left: { x: number; z: number },
  right: { x: number; z: number }
): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}
