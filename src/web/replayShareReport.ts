import type { FloorplanEventReplay, FloorplanReplayDeviceRole, FloorplanReplayTimelinePhase, ReplayDeviceState, ReplayStepKind } from './floorplan3dModel';

export interface ReplayShareReport {
  schemaVersion: 1;
  readOnly: true;
  title: string;
  ruleId: string;
  roomId: string;
  severity: string;
  sourceDeviceId: string | null;
  targetDeviceId: string | null;
  focusDeviceId: string | null;
  devices: ReplayShareDevice[];
  steps: ReplayShareStep[];
}

export interface ReplayShareDevice {
  deviceId: string;
  displayName: string;
  role: FloorplanReplayDeviceRole;
  timeline: Array<{
    sequence: number;
    simTime: string;
    phase: FloorplanReplayTimelinePhase;
    state: ReplayDeviceState;
    commandStatus?: string;
    commandReason?: string | null;
  }>;
}

export interface ReplayShareStep {
  id: string;
  kind: ReplayStepKind;
  label: string;
  detail: string;
  roomId: string;
  deviceId: string | null;
  sequence: number;
  commandStatus?: string;
  commandReason?: string | null;
  previousState?: ReplayDeviceState;
  nextState?: ReplayDeviceState;
  stateSnapshot?: ReplayDeviceState;
}

export function buildReplayShareReport(replay: FloorplanEventReplay): ReplayShareReport {
  return {
    schemaVersion: 1,
    readOnly: true,
    title: replay.title,
    ruleId: replay.ruleId,
    roomId: replay.roomId,
    severity: replay.severity,
    sourceDeviceId: replay.sourceDeviceId ?? null,
    targetDeviceId: replay.targetDeviceId ?? null,
    focusDeviceId: replay.focusDeviceId ?? null,
    devices: replay.deviceTimelines.map((timeline) => ({
      deviceId: timeline.deviceId,
      displayName: timeline.displayName,
      role: timeline.role,
      timeline: timeline.entries.map((entry) => ({
        sequence: entry.atSequence,
        simTime: entry.simTime,
        phase: entry.phase,
        state: entry.state,
        commandStatus: entry.commandStatus,
        commandReason: entry.commandReason
      }))
    })),
    steps: replay.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      label: step.label,
      detail: step.detail,
      roomId: step.roomId,
      deviceId: step.deviceId ?? null,
      sequence: step.atSequence,
      commandStatus: step.commandStatus,
      commandReason: step.commandReason,
      previousState: step.previousState,
      nextState: step.nextState,
      stateSnapshot: step.stateSnapshot
    }))
  };
}
