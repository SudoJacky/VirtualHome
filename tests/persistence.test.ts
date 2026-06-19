import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSimulator } from '../src/sim/engine';
import { TwinDatabase } from '../src/server/persistence';
import type { DeviceTelemetryEvent } from '../src/shared/types';

describe('twin persistence', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores state snapshots, events, and telemetry in SQLite', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-'));
    dirs.push(dir);
    const db = new TwinDatabase(path.join(dir, 'twin.db'));
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const events = simulator.advanceMinutes(12);
    db.recordSnapshot(simulator.getSnapshot());
    db.recordEvents(events);

    expect(db.getLatestSnapshot()?.homeState.mode).toBe('morning');
    expect(db.getRecentEvents(50).some((event) => event.type === 'ActivityStarted')).toBe(true);
    expect(db.getRecentTelemetry(50).some((event) => event.type === 'DeviceTelemetry')).toBe(true);

    db.close();
  });

  it('appends events from separate runs without replacing same-sequence history', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-'));
    dirs.push(dir);
    const db = new TwinDatabase(path.join(dir, 'twin.db'));
    const simulator = createSimulator({ seed: 42 });

    const firstStart = simulator.startScenario('weekday_normal');
    db.recordSnapshot(simulator.getSnapshot());
    db.recordEvents(firstStart);
    const firstRunId = simulator.getSnapshot().runId;

    const secondStart = simulator.startScenario('away_day');
    db.recordSnapshot(simulator.getSnapshot());
    db.recordEvents(secondStart);
    const secondRunId = simulator.getSnapshot().runId;

    const recent = db.getRecentEvents(10)
      .filter((event) => event.type === 'ScenarioControl');

    expect(firstRunId).not.toBe(secondRunId);
    expect(recent.map((event) => event.runId).sort()).toEqual([firstRunId, secondRunId].sort());
    expect(new Set(recent.map((event) => event.id)).size).toBe(2);
    expect(recent.every((event) => event.sequence === 1)).toBe(true);

    db.close();
  });

  it('records snapshots and events atomically with a covered sequence checkpoint', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-'));
    dirs.push(dir);
    const db = new TwinDatabase(path.join(dir, 'twin.db'));
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const firstEvents = simulator.advanceMinutes(12);
    const firstSnapshot = simulator.getSnapshot();
    db.recordUpdate(firstSnapshot, firstEvents);
    const firstCheckpoint = db.getLatestSnapshotCheckpoint();

    expect(firstCheckpoint?.coveredSequence).toBe(firstSnapshot.simClock.sequence);
    expect(db.getRecentEvents(100, firstSnapshot.runId).length).toBe(firstEvents.length);

    simulator.advanceMinutes(1);
    const laterSnapshot = simulator.getSnapshot();
    expect(() => db.recordUpdate(laterSnapshot, firstEvents)).toThrow();

    const checkpointAfterFailure = db.getLatestSnapshotCheckpoint();
    expect(checkpointAfterFailure?.snapshot.simClock.sequence).toBe(firstSnapshot.simClock.sequence);
    expect(checkpointAfterFailure?.coveredSequence).toBe(firstSnapshot.simClock.sequence);

    db.close();
  });

  it('keeps events append-only while writing full snapshots only at checkpoint cadence', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-'));
    dirs.push(dir);
    const db = new TwinDatabase(path.join(dir, 'twin.db'), { snapshotIntervalEvents: 100 });
    const simulator = createSimulator({ seed: 42 });

    const startEvents = simulator.startScenario('weekday_normal');
    const startSnapshot = simulator.getSnapshot();
    db.recordUpdate(startSnapshot, startEvents);

    const advanceEvents = simulator.advanceMinutes(1);
    const laterSnapshot = simulator.getSnapshot();
    db.recordUpdate(laterSnapshot, advanceEvents);

    const checkpoint = db.getLatestSnapshotCheckpoint();
    expect(db.getSnapshotCount(laterSnapshot.runId)).toBe(1);
    expect(checkpoint?.coveredSequence).toBe(startSnapshot.simClock.sequence);
    expect(db.getRecentEvents(500, laterSnapshot.runId).length).toBe(startEvents.length + advanceEvents.length);

    db.close();
  });

  it('retains only the newest telemetry rows and matching telemetry events per run when retention is configured', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-'));
    dirs.push(dir);
    const db = new TwinDatabase(path.join(dir, 'twin.db'), { telemetryRetentionEvents: 3 });
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const firstEvents = simulator.advanceMinutes(12);
    const firstSnapshot = simulator.getSnapshot();
    db.recordUpdate(firstSnapshot, firstEvents);

    const secondEvents = simulator.advanceMinutes(4);
    const secondSnapshot = simulator.getSnapshot();
    db.recordUpdate(secondSnapshot, secondEvents);

    const allEvents = [...firstEvents, ...secondEvents];
    const expectedTelemetryIds = allEvents
      .filter((event): event is DeviceTelemetryEvent => event.type === 'DeviceTelemetry')
      .slice(-3)
      .reverse()
      .map((event) => event.id);

    const retainedEvents = db.getRecentEvents(500, secondSnapshot.runId);
    const retainedTelemetryEventIds = retainedEvents
      .filter((event): event is DeviceTelemetryEvent => event.type === 'DeviceTelemetry')
      .map((event) => event.id);
    const expectedDomainEventCount = allEvents.filter((event) => event.type !== 'DeviceTelemetry').length;

    expect(db.getRecentTelemetry(50, secondSnapshot.runId).map((event) => event.id)).toEqual(expectedTelemetryIds);
    expect(retainedTelemetryEventIds).toEqual(expectedTelemetryIds);
    expect(retainedEvents.length).toBe(expectedDomainEventCount + expectedTelemetryIds.length);

    db.close();
  });
});
