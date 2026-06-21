import type { DeviceCommandLifecycleStatus } from './deviceRegistry';

export interface DeviceCommandTimelineEntry {
  status: DeviceCommandLifecycleStatus;
  at: string;
  reason: string | null;
}

export function createDeviceCommandTimeline({
  terminalStatus,
  at,
  reason
}: {
  terminalStatus: 'acknowledged' | 'failed';
  at: string;
  reason: string | null;
}): DeviceCommandTimelineEntry[] {
  return [
    { status: 'requested', at, reason: null },
    { status: 'sent', at, reason: null },
    { status: terminalStatus, at, reason: terminalStatus === 'failed' ? reason : null }
  ];
}
