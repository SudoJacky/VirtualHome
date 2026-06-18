import type { DeviceTelemetryEvent } from '../shared/types';

export interface TelemetrySummary {
  runId: string | null;
  window: {
    eventLimit: number;
    eventCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  devices: Array<{
    deviceId: string;
    roomId: string;
    deviceType: string;
    metrics: Record<string, {
      count: number;
      min: number;
      max: number;
      avg: number;
      latest: number | boolean;
    }>;
  }>;
}

interface MetricAccumulator {
  count: number;
  min: number;
  max: number;
  sum: number;
  latest: number | boolean;
}

interface DeviceAccumulator {
  deviceId: string;
  roomId: string;
  deviceType: string;
  metrics: Map<string, MetricAccumulator>;
}

export function summarizeTelemetry(events: DeviceTelemetryEvent[], eventLimit: number, runId: string | null): TelemetrySummary {
  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  const devices = new Map<string, DeviceAccumulator>();

  for (const event of orderedEvents) {
    const device = devices.get(event.deviceId) ?? {
      deviceId: event.deviceId,
      roomId: event.roomId,
      deviceType: event.deviceType,
      metrics: new Map<string, MetricAccumulator>()
    };
    devices.set(event.deviceId, device);

    for (const [metricName, value] of Object.entries(event.measurements)) {
      const metric = device.metrics.get(metricName);
      if (typeof value === 'number') {
        device.metrics.set(metricName, metric ? {
          count: metric.count + 1,
          min: Math.min(metric.min, value),
          max: Math.max(metric.max, value),
          sum: metric.sum + value,
          latest: value
        } : {
          count: 1,
          min: value,
          max: value,
          sum: value,
          latest: value
        });
      } else {
        device.metrics.set(metricName, {
          count: (metric?.count ?? 0) + 1,
          min: metric?.min ?? 0,
          max: metric?.max ?? 0,
          sum: metric?.sum ?? 0,
          latest: value
        });
      }
    }
  }

  return {
    runId,
    window: {
      eventLimit,
      eventCount: orderedEvents.length,
      firstSeenAt: orderedEvents[0]?.simTime ?? null,
      lastSeenAt: orderedEvents.at(-1)?.simTime ?? null
    },
    devices: [...devices.values()]
      .map((device) => ({
        deviceId: device.deviceId,
        roomId: device.roomId,
        deviceType: device.deviceType,
        metrics: Object.fromEntries([...device.metrics.entries()].map(([metricName, metric]) => [
          metricName,
          {
            count: metric.count,
            min: round(metric.min),
            max: round(metric.max),
            avg: round(metric.count > 0 ? metric.sum / metric.count : 0),
            latest: typeof metric.latest === 'number' ? round(metric.latest) : metric.latest
          }
        ]))
      }))
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
