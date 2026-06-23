import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bell,
  Brain,
  Bug,
  CalendarDays,
  Clock,
  Copy,
  FileDown,
  Home,
  Pause,
  Play,
  Radar,
  Shuffle,
  StepForward,
  Zap
} from 'lucide-react';
import type { DeviceState, RoomId, TwinEvent, TwinSnapshot } from '../shared/types';
import { Floorplan3D, type FloorplanLayers, type FloorplanSelection } from './Floorplan3D';
import { HomeMemoryView } from './HomeMemoryView';
import { ApiClientError, createIdempotencyKey, getJson, postAlertStatus, postDeviceCommand, postUpdate, type ApiUpdate, type DeviceCommandValue } from './apiClient';
import { confirmDeviceCommand } from './deviceCommandSafety';
import { createFloorplan3DModel, type Floorplan3DDevice, type Floorplan3DRoom, type FloorplanDeviceDisplayMode, type FloorplanEventReplay } from './floorplan3dModel';
import { buildReplayShareReport } from './replayShareReport';
import { createScenarioScriptPlan } from './scenarioScriptPlan';
import { buildTwinSocketUrl, cursorFromSnapshot, cursorFromUpdate, needsFullTwinRefresh, nextReconnectDelayMs, parseTwinSocketMessage, type TwinSocketCursor } from './twinSocket';
import { createDashboardModel, mergeTwinEvents } from './viewModel';
import './styles.css';

function App(): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<TwinSnapshot | null>(null);
  const [events, setEvents] = React.useState<TwinEvent[]>([]);
  const [sidebarMode, setSidebarMode] = React.useState<'home' | 'memory' | 'studio' | 'debug'>('home');
  const [floorplanView, setFloorplanView] = React.useState<'3d' | '2d'>('3d');
  const [deviceDisplayMode, setDeviceDisplayMode] = React.useState<FloorplanDeviceDisplayMode>('active');
  const [dailyDate, setDailyDate] = React.useState(() => todayInShanghai());
  const [dailySeed, setDailySeed] = React.useState(20260617);
  const [floorplanLayers, setFloorplanLayers] = React.useState<FloorplanLayers>({
    people: true,
    devices: true,
    environment: false,
    alerts: true
  });
  const [floorplanSelection, setFloorplanSelection] = React.useState<FloorplanSelection>(null);
  const [activeReplayId, setActiveReplayId] = React.useState<string | null>(null);
  const [activeReplayStepIndex, setActiveReplayStepIndex] = React.useState(0);
  const [activeDemoSpotlightId, setActiveDemoSpotlightId] = React.useState<string | null>(null);
  const [demoHoldUntil, setDemoHoldUntil] = React.useState<string | null>(null);
  const [selectedForecastMetricByCard, setSelectedForecastMetricByCard] = React.useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [failedAction, setFailedAction] = React.useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [socketStatus, setSocketStatus] = React.useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [lastHeartbeatAt, setLastHeartbeatAt] = React.useState<string | null>(null);
  const demoHoldTimerRef = React.useRef<number | null>(null);
  const pointerActivationRef = React.useRef(false);
  const socketCursorRef = React.useRef<TwinSocketCursor | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;

    async function refreshSnapshotFromApi(): Promise<void> {
      const state = await getJson<TwinSnapshot>('/api/state');
      if (disposed) return;
      socketCursorRef.current = cursorFromSnapshot(state);
      setSnapshot(state);
    }

    async function refreshTwinStateFromApi(): Promise<void> {
      const [state, recentEvents] = await Promise.all([
        getJson<TwinSnapshot>('/api/state'),
        getJson<TwinEvent[]>('/api/events?limit=80')
      ]);
      if (disposed) return;
      socketCursorRef.current = cursorFromSnapshot(state);
      setSnapshot(state);
      setEvents(recentEvents);
    }

    void refreshSnapshotFromApi().catch(() => {
      if (!disposed) {
        setSocketStatus('offline');
      }
    });
    void getJson<TwinEvent[]>('/api/events?limit=80').then(setEvents).catch(() => {
      if (!disposed) {
        setSocketStatus('offline');
      }
    });

    function connect(): void {
      if (disposed) return;
      setSocketStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
      socket = new WebSocket(buildTwinSocketUrl(window.location, socketCursorRef.current));
      socket.addEventListener('open', () => {
        reconnectAttempt = 0;
        setSocketStatus('live');
      });
      socket.addEventListener('message', (message) => {
        const update = parseTwinSocketMessage(String(message.data));
        if (update.type === 'twin.heartbeat') {
          setLastHeartbeatAt(update.ts);
          setSocketStatus('live');
          return;
        }
        if (update.type === 'twin.run_changed') {
          socketCursorRef.current = { runId: update.runId, sequence: update.sequence };
          setSnapshot(update.snapshot);
          setEvents([]);
          setSocketStatus('live');
          return;
        }
        socketCursorRef.current = cursorFromUpdate(update);
        if (needsFullTwinRefresh(update)) {
          if (update.snapshot) {
            setSnapshot(update.snapshot);
          }
          setEvents([]);
          void refreshTwinStateFromApi().catch(() => {
            if (!disposed) {
              setSocketStatus('offline');
            }
          });
          setSocketStatus('live');
          return;
        }
        if (update.snapshot) {
          setSnapshot(update.snapshot);
        } else {
          void refreshSnapshotFromApi().catch(() => {
            if (!disposed) {
              setSocketStatus('offline');
            }
          });
        }
        setEvents((current) => mergeTwinEvents(current, update.events));
        setSocketStatus('live');
      });
      socket.addEventListener('close', () => {
        if (disposed) return;
        setSocketStatus('reconnecting');
        reconnectTimer = setTimeout(connect, nextReconnectDelayMs(reconnectAttempt));
        reconnectAttempt += 1;
      });
      socket.addEventListener('error', () => {
        if (!disposed) {
          setSocketStatus('offline');
        }
      });
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, []);

  React.useEffect(() => {
    return () => {
      if (demoHoldTimerRef.current !== null) {
        window.clearTimeout(demoHoldTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!snapshot || sidebarMode !== 'studio') {
      return;
    }
    const demoModel = createDashboardModel(snapshot, events);
    const spotlight = demoModel.demoSpotlight;
    if (!spotlight || spotlight.id === activeDemoSpotlightId) {
      return;
    }

    const demoFloorplanModel = createFloorplan3DModel(snapshot, events);
    const replay = spotlight.replayRuleId
      ? demoFloorplanModel.eventReplays.find((candidate) => candidate.ruleId === spotlight.replayRuleId) ?? null
      : null;
    const replayStep = replay?.steps[0] ?? null;

    setActiveDemoSpotlightId(spotlight.id);
    setFloorplanView('3d');
    setFloorplanLayers((current) => ({ ...current, alerts: true, devices: true, environment: true }));
    if (replay && replayStep) {
      setActiveReplayId(replay.id);
      setActiveReplayStepIndex(0);
      setFloorplanSelection(replayStep.deviceId ? { type: 'device', id: replayStep.deviceId } : { type: 'room', id: replayStep.roomId });
      return;
    }
    setFloorplanSelection(spotlight.focusDeviceId ? { type: 'device', id: spotlight.focusDeviceId } : { type: 'room', id: spotlight.roomId });
  }, [activeDemoSpotlightId, events, sidebarMode, snapshot]);

  async function startDailySimulation(idempotencyKey: string): Promise<void> {
    resetDemoSpotlight();
    const update = await postUpdate('/api/daily/start', { date: dailyDate, seed: dailySeed }, { idempotencyKey });
    applyUpdate(update, true);
  }

  async function startScenarioCard(cardId: string, idempotencyKey: string): Promise<void> {
    resetDemoSpotlight();
    const plan = createScenarioScriptPlan(cardId);
    let combinedEvents: TwinEvent[] = [];
    let latestSnapshot: TwinSnapshot | null = snapshot;

    for (const [index, action] of plan.entries()) {
      const stepKey = `${idempotencyKey}:${index}:${action.kind}`;
      const update = action.kind === 'startScenario'
        ? await postUpdate(`/api/scenarios/${action.scenarioId}/start`, {}, { idempotencyKey: stepKey })
        : action.kind === 'advance'
          ? await postUpdate('/api/control/advance', { minutes: action.minutes }, { idempotencyKey: stepKey })
          : action.kind === 'inject'
            ? await postUpdate('/api/control/inject', { kind: action.abnormality }, { idempotencyKey: stepKey })
            : action.kind === 'resolve'
              ? await postUpdate('/api/control/resolve', { kind: action.abnormality }, { idempotencyKey: stepKey })
              : await postDeviceCommand(action.deviceId, action.command, action.value ?? null, { idempotencyKey: stepKey });
      latestSnapshot = update.snapshot;
      combinedEvents = [...combinedEvents, ...update.events];
    }

    if (plan.length > 0 && latestSnapshot) {
      applyUpdate({ snapshot: latestSnapshot, events: combinedEvents }, true);
      if (plan.length > 1) {
        holdDemoSpotlight(2000);
      }
    } else {
      setApiError(`Unknown scenario script: ${cardId}`);
    }
  }

  async function advance(minutes: number, idempotencyKey: string): Promise<void> {
    const update = await postUpdate('/api/control/advance', { minutes }, { idempotencyKey });
    applyUpdate(update);
  }

  async function inject(kind: string, idempotencyKey: string): Promise<void> {
    const update = await postUpdate('/api/control/inject', { kind }, { idempotencyKey });
    applyUpdate(update);
  }

  async function resolve(kind: string, idempotencyKey: string): Promise<void> {
    const update = await postUpdate('/api/control/resolve', { kind }, { idempotencyKey });
    applyUpdate(update);
  }

  async function changeAlertStatus(alertId: string, status: 'active' | 'acknowledged' | 'resolved' | 'ignored', idempotencyKey: string): Promise<void> {
    const update = await postAlertStatus(alertId, status, { idempotencyKey });
    applyUpdate(update);
  }

  async function executeDeviceCommand(deviceId: string, command: string, value: DeviceCommandValue, idempotencyKey: string): Promise<void> {
    const update = await postDeviceCommand(deviceId, command, value, { idempotencyKey });
    applyUpdate(update);
  }

  async function setPaused(paused: boolean, idempotencyKey: string): Promise<void> {
    const update = await postUpdate(paused ? '/api/control/pause' : '/api/control/resume', {}, { idempotencyKey });
    applyUpdate(update);
  }

  function applyUpdate(update: ApiUpdate, replaceEvents = false): void {
    socketCursorRef.current = cursorFromSnapshot(update.snapshot);
    setSnapshot(update.snapshot);
    setEvents((current) => replaceEvents ? update.events : mergeTwinEvents(current, update.events));
  }

  async function runApiAction(label: string, action: (idempotencyKey: string) => Promise<void>, idempotencyKey = createIdempotencyKey()): Promise<void> {
    setPendingAction(label);
    setApiError(null);
    try {
      await action(idempotencyKey);
      setFailedAction(null);
    } catch (error) {
      setApiError(formatApiActionError(error));
      setFailedAction({ label, run: () => runApiAction(label, action, idempotencyKey) });
    } finally {
      setPendingAction(null);
    }
  }

  function resetDemoSpotlight(): void {
    setActiveDemoSpotlightId(null);
    setDemoHoldUntil(null);
    setActiveReplayId(null);
    setActiveReplayStepIndex(0);
    if (demoHoldTimerRef.current !== null) {
      window.clearTimeout(demoHoldTimerRef.current);
      demoHoldTimerRef.current = null;
    }
  }

  function holdDemoSpotlight(ms: number): void {
    setDemoHoldUntil(new Date(Date.now() + ms).toISOString());
    void setPaused(true, createIdempotencyKey());
    if (demoHoldTimerRef.current !== null) {
      window.clearTimeout(demoHoldTimerRef.current);
    }
    demoHoldTimerRef.current = window.setTimeout(() => {
      setDemoHoldUntil(null);
      demoHoldTimerRef.current = null;
      void setPaused(false, createIdempotencyKey());
    }, ms);
  }

  if (!snapshot) {
    return <div className="loading">Loading VirtualHome Twin...</div>;
  }

  const model = createDashboardModel(snapshot, events);
  const floorplanModel = createFloorplan3DModel(snapshot, events);
  const selectedRoom = floorplanSelection?.type === 'room'
    ? floorplanModel.rooms.find((room) => room.id === floorplanSelection.id) ?? null
    : null;
  const selectedDevice = floorplanSelection?.type === 'device'
    ? floorplanModel.devices.find((device) => device.id === floorplanSelection.id) ?? null
    : null;
  const activeReplay = activeReplayId
    ? floorplanModel.eventReplays.find((replay) => replay.id === activeReplayId) ?? null
    : null;
  const activeReplayStep = activeReplay?.steps[activeReplayStepIndex] ?? null;

  function toggleFloorplanLayer(layer: keyof FloorplanLayers): void {
    setFloorplanLayers((current) => ({ ...current, [layer]: !current[layer] }));
  }

  function focusReplayStep(replay: FloorplanEventReplay, stepIndex: number): void {
    const step = replay.steps[stepIndex] ?? replay.steps[0];
    setActiveReplayId(replay.id);
    setActiveReplayStepIndex(stepIndex);
    setFloorplanSelection(step.deviceId ? { type: 'device', id: step.deviceId } : { type: 'room', id: step.roomId });
    setFloorplanLayers((current) => ({ ...current, alerts: true, devices: true, environment: true }));
  }

  function startReplayForRecord(record: ReturnType<typeof createDashboardModel>['controlRecords'][number]): void {
    const ruleId = record.reason.startsWith('rule:') ? record.reason.slice('rule:'.length) : '';
    const replay = floorplanModel.eventReplays.find((candidate) => candidate.ruleId === ruleId);
    if (replay) {
      focusReplayStep(replay, 0);
      return;
    }
    setFloorplanSelection({ type: 'device', id: record.deviceId });
  }

  function focusReplayForAlert(alertId: string): void {
    const workflow = model.alertWorkflows.find((item) => item.alertId === alertId);
    const alert = snapshot?.alerts[alertId];
    if (!workflow || !alert) return;
    const replay = alert.sourceRuleId
      ? floorplanModel.eventReplays.find((candidate) => candidate.ruleId === alert.sourceRuleId)
      : null;
    if (replay) {
      focusReplayStep(replay, 0);
      return;
    }
    setFloorplanSelection({ type: 'room', id: alert.roomId });
  }

  function handleAlertAction(
    workflow: ReturnType<typeof createDashboardModel>['alertWorkflows'][number],
    action: ReturnType<typeof createDashboardModel>['alertWorkflows'][number]['actions'][number]
  ): void {
    if (action.kind === 'replay' || action.kind === 'evidence') {
      focusReplayForAlert(workflow.alertId);
      return;
    }
    if (action.kind === 'remind') {
      setApiError(null);
      setPendingAction('Reminder noted');
      window.setTimeout(() => setPendingAction(null), 900);
      return;
    }
    if (!action.status) return;
    if (action.highRisk && !window.confirm(`${action.label} for ${workflow.title}?`)) {
      return;
    }
    void runApiAction(action.label, (key) => changeAlertStatus(workflow.alertId, action.status!, key));
  }

  function activateFromPointer(action: () => void): void {
    pointerActivationRef.current = true;
    action();
  }

  function activateFromClick(action: () => void): void {
    if (pointerActivationRef.current) {
      pointerActivationRef.current = false;
      return;
    }
    action();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Home size={24} />
          <div>
            <strong>VirtualHome</strong>
            <span>{sidebarMode === 'home' ? 'Home' : sidebarMode === 'memory' ? 'Memory' : sidebarMode === 'studio' ? 'Studio' : 'Debug'}</span>
          </div>
        </div>

        <div className="mode-toggle" aria-label="Console mode">
          <button className={sidebarMode === 'home' ? 'active' : ''} onClick={() => setSidebarMode('home')}>
            <Home size={14} /> Home
          </button>
          <button className={sidebarMode === 'memory' ? 'active' : ''} onClick={() => setSidebarMode('memory')}>
            <Brain size={14} /> Memory
          </button>
          <button className={sidebarMode === 'studio' ? 'active' : ''} onClick={() => setSidebarMode('studio')}>
            <Play size={14} /> Studio
          </button>
          <button className={sidebarMode === 'debug' ? 'active' : ''} onClick={() => setSidebarMode('debug')}>
            <Bug size={14} /> Debug
          </button>
        </div>

        {sidebarMode === 'home' ? (
          <>
            <section className="control-group home-briefing-sidebar">
              <h2>Briefing</h2>
              <strong>{model.homeBriefing.status}</strong>
              <span>{model.homeBriefing.summary}</span>
              <small>{model.homeBriefing.nextAction}</small>
            </section>
            <section className="control-group">
              <h2>Quick actions</h2>
              <button onClick={() => setFloorplanSelection(model.homeBriefing.primaryItem ? { type: 'room', id: model.homeBriefing.primaryItem.roomId } : null)}>
                <Radar size={16} /> Focus priority
              </button>
              <button onClick={() => setFloorplanView('3d')}><Play size={16} /> Open 3D view</button>
            </section>
          </>
        ) : sidebarMode === 'memory' ? (
          <section className="control-group">
            <h2>Memory</h2>
            <button onClick={() => setSidebarMode('home')}><Home size={16} /> Back to home</button>
            <button onClick={() => setSidebarMode('debug')}><Bug size={16} /> Open debug</button>
          </section>
        ) : sidebarMode === 'studio' ? (
          <>
            <section className="control-group">
              <h2>Playback</h2>
              <button onClick={() => void runApiAction(snapshot.simClock.paused ? 'Resume simulation' : 'Pause simulation', (key) => setPaused(!snapshot.simClock.paused, key))}>
                {snapshot.simClock.paused ? <Play size={16} /> : <Pause size={16} />}
                {snapshot.simClock.paused ? 'Resume simulation' : 'Pause simulation'}
              </button>
              <button onClick={() => void runApiAction('Jump 15 min', (key) => advance(15, key))}><Zap size={16} /> Jump 15 min</button>
            </section>
            <section className="control-group scenario-script">
              <h2>Scenario Scripts</h2>
              {model.scenarioCards.map((scenario) => (
                <button key={scenario.id} className="scenario-card" onClick={() => void runApiAction(scenario.title, (key) => startScenarioCard(scenario.id, key))}>
                  <strong>{scenario.title}</strong>
                  <span>{scenario.businessValue}</span>
                  <small>{scenario.expectedTimeline}</small>
                  <ul>
                    <li>{scenario.expectedDeviceActions[0]}</li>
                    <li>{scenario.expectedAlerts[0]}</li>
                    <li>{scenario.recordsGenerated}</li>
                  </ul>
                </button>
              ))}
            </section>
          </>
        ) : (
          <>
            <section className="control-group">
              <h2>Daily Simulation</h2>
              <label className="field-label" htmlFor="daily-date">Date</label>
              <input
                id="daily-date"
                className="control-input"
                type="date"
                value={dailyDate}
                onChange={(event) => setDailyDate(event.target.value)}
              />
              <label className="field-label" htmlFor="daily-seed">Seed</label>
              <div className="seed-row">
                <input
                  id="daily-seed"
                  className="control-input"
                  inputMode="numeric"
                  type="number"
                  value={dailySeed}
                  onChange={(event) => setDailySeed(Number(event.target.value || 0))}
                />
                <button className="icon-button sidebar-icon-button" title="Random seed" onClick={() => setDailySeed(Math.floor(Math.random() * 99999999))}>
                  <Shuffle size={16} />
                </button>
              </div>
              <button onClick={() => void runApiAction('Generate day', startDailySimulation)}><CalendarDays size={16} /> Generate day</button>
            </section>

            <section className="control-group">
              <h2>Control</h2>
              <button onClick={() => void runApiAction('+1 min', (key) => advance(1, key))}><StepForward size={16} /> +1 min</button>
              <button onClick={() => void runApiAction('+15 min', (key) => advance(15, key))}><Zap size={16} /> +15 min</button>
              <button onClick={() => void runApiAction(snapshot.simClock.paused ? 'Resume' : 'Pause', (key) => setPaused(!snapshot.simClock.paused, key))}>
                <Pause size={16} /> {snapshot.simClock.paused ? 'Resume' : 'Pause'}
              </button>
            </section>

            <section className="control-group">
              <h2>Inject</h2>
              <button onClick={() => void runApiAction('Fridge open', (key) => inject('fridge_left_open', key))}><Bell size={16} /> Fridge open</button>
              <button onClick={() => void runApiAction('Door open', (key) => inject('door_left_open', key))}><Bell size={16} /> Door open</button>
              <button onClick={() => void runApiAction('Network off', (key) => inject('network_offline', key))}><Bell size={16} /> Network off</button>
            </section>

            <section className="control-group">
              <h2>Resolve</h2>
              <button onClick={() => void runApiAction('Resolve fridge', (key) => resolve('fridge_left_open', key))}><Bell size={16} /> Fridge closed</button>
              <button onClick={() => void runApiAction('Resolve door', (key) => resolve('door_left_open', key))}><Bell size={16} /> Door secured</button>
              <button onClick={() => void runApiAction('Resolve network', (key) => resolve('network_offline', key))}><Bell size={16} /> Network online</button>
            </section>
          </>
        )}
      </aside>

      <section className="workspace">
        {sidebarMode === 'memory' ? (
          <HomeMemoryView />
        ) : (
          <>
        <header className="topbar">
          <div>
            <span className="eyebrow">Current mode</span>
            <h1>{model.homeMode.replace('_', ' ')}</h1>
          </div>
          <div className="run-status">
            <span className={`status-pill ${snapshot.simClock.paused ? 'paused' : 'running'}`}>
              <i />
              {snapshot.simClock.paused ? 'Paused' : 'Auto running'}
            </span>
            <div className="sim-time" title={model.simTime}><Clock size={16} /> {model.simCalendar.fullLabel}</div>
            <span className={`status-pill socket-${socketStatus}`} title={lastHeartbeatAt ? `Last heartbeat ${formatTime(lastHeartbeatAt)}` : undefined}>
              <i />
              {socketStatusLabel(socketStatus)}
            </span>
          </div>
        </header>

        <section className="metric-row">
          <Metric label="People home" value={model.occupancyCount} />
          <Metric label="Occupied rooms" value={model.occupiedRooms.length} />
          <Metric label="Active devices" value={model.activeDeviceCount} />
          <Metric label="Unresolved alerts" value={model.alertStatusSummary.unresolved} intent={model.alertStatusSummary.unresolved > 0 ? 'alert' : 'normal'} />
          <Metric label="Acknowledged" value={model.alertStatusSummary.acknowledged} />
        </section>

        {pendingAction || apiError ? (
          <section className={`api-status ${apiError ? 'error' : 'pending'}`} role={apiError ? 'alert' : 'status'}>
            <div>
              <strong>{apiError ? 'Request failed' : 'Request in progress'}</strong>
              <span>{apiError ?? pendingAction}</span>
            </div>
            {apiError && failedAction ? (
              <button onClick={() => void failedAction.run()}>Retry {failedAction.label}</button>
            ) : null}
          </section>
        ) : null}

        <section className="main-grid">
          <div className="floorplan-view">
            <div className="view-toggle" aria-label="Floorplan view">
              <button className={floorplanView === '3d' ? 'active' : ''} onClick={() => setFloorplanView('3d')}>3D</button>
              <button className={floorplanView === '2d' ? 'active' : ''} onClick={() => setFloorplanView('2d')}>2D</button>
              <select
                aria-label="3D device display mode"
                value={deviceDisplayMode}
                onChange={(event) => setDeviceDisplayMode(event.target.value as FloorplanDeviceDisplayMode)}
              >
                <option value="active">Focus</option>
                <option value="all">All devices</option>
                <option value="abnormal">Abnormal</option>
                <option value="sensor">Sensors</option>
                <option value="actuator">Actuators</option>
                <option value="appliance">Appliances</option>
                <option value="security">Security</option>
                <option value="lighting">Lighting</option>
                <option value="climate">Climate</option>
                <option value="media">Media</option>
                <option value="mobile">Mobile</option>
                <option value="network">Network</option>
              </select>
            </div>
            {floorplanView === '3d' ? (
              <Floorplan3D
                model={floorplanModel}
                layers={floorplanLayers}
                selected={floorplanSelection}
                deviceDisplayMode={deviceDisplayMode}
                replayFocusDeviceId={activeReplayStep?.deviceId ?? null}
                onToggleLayer={toggleFloorplanLayer}
                onSelect={setFloorplanSelection}
              />
            ) : (
              <Floorplan2D
                rooms={model.floorplanRooms}
                selected={floorplanSelection?.type === 'room' ? floorplanSelection.id : null}
                onSelect={(roomId) => setFloorplanSelection({ type: 'room', id: roomId })}
                onSelectDevice={(deviceId) => setFloorplanSelection({ type: 'device', id: deviceId })}
              />
            )}
          </div>

          <div className="dashboard-side-stack">
            <ReplayPanel
              replay={activeReplay}
              activeStepIndex={activeReplayStepIndex}
              activeStepId={activeReplayStep?.id ?? null}
              onStepSelect={(stepIndex) => activeReplay ? focusReplayStep(activeReplay, stepIndex) : undefined}
              onNext={() => activeReplay ? focusReplayStep(activeReplay, Math.min(activeReplayStepIndex + 1, activeReplay.steps.length - 1)) : undefined}
              onClose={() => {
                setActiveReplayId(null);
                setActiveReplayStepIndex(0);
              }}
            />

            <SelectionPanel
              room={selectedRoom}
              device={selectedDevice}
              snapshotDevice={selectedDevice ? snapshot.devices[selectedDevice.id] : null}
              deviceControlCard={selectedDevice ? model.deviceControlCards.find((card) => card.deviceId === selectedDevice.id) ?? null : null}
              roomOccupants={selectedRoom ? model.floorplanRooms[selectedRoom.id].people : []}
              roomDevices={selectedRoom ? model.floorplanRooms[selectedRoom.id].devices : []}
              focusDevices={Object.values(model.floorplanRooms).flatMap((item) => item.devices)}
              roomRecords={selectedRoom ? model.controlRecords.filter((record) => record.roomName === selectedRoom.label).slice(0, 3) : []}
              activeDeviceCount={model.activeDeviceCount}
              occupiedRoomCount={model.occupiedRooms.length}
              onSelectDevice={(deviceId) => setFloorplanSelection({ type: 'device', id: deviceId })}
              onCommand={(deviceId, command, value) => void runApiAction(`${command} ${deviceId}`, (key) => executeDeviceCommand(deviceId, command, value, key))}
            />
          </div>
        </section>

        <section className="overview-grid">
          <section className={`panel home-briefing ${model.homeBriefing.status === 'Needs attention' ? 'alert' : model.homeBriefing.status === 'Watch' ? 'watch' : 'normal'}`}>
            <div>
              <span className="eyebrow">Home briefing</span>
              <h2>{model.homeBriefing.status}</h2>
              <p>{model.homeBriefing.summary}</p>
            </div>
            <div className="briefing-primary">
              <strong>{model.homeBriefing.primaryItem?.headline ?? 'No priority item'}</strong>
              <span>{model.homeBriefing.primaryItem?.summary ?? 'The home is operating within expected ranges.'}</span>
              <small>{model.homeBriefing.nextAction}</small>
            </div>
            <div className="briefing-highlights">
              {model.homeBriefing.highlights.map((highlight) => <span key={highlight}>{highlight}</span>)}
            </div>
          </section>

          <section className="story-row">
            <div className="story-card primary-story">
              <span className="eyebrow">Current household activity</span>
              <h2>{model.householdActivity.title}</h2>
              <p>{model.householdActivity.summary}</p>
              <div className="tag-row">
                <span>{model.householdActivity.roomName}</span>
                {model.householdActivity.participants.slice(0, 4).map((participant) => <span key={participant}>{participant}</span>)}
              </div>
              <small>{model.householdActivity.nextAction}</small>
            </div>
            <div className="story-card">
              <span className="eyebrow">Latest automation</span>
              {model.automationExplanations[0] ? (
                <>
                  <h2>{model.automationExplanations[0].ruleName}</h2>
                  <p>{model.automationExplanations[0].explanation}</p>
                  <small>{model.automationExplanations[0].actions.join(', ')}</small>
                </>
              ) : (
                <p className="muted">No automation rule has fired yet.</p>
              )}
            </div>
            <div className="story-card">
              <span className="eyebrow">Latest control record</span>
              {model.controlRecords[0] ? (
                <>
                  <h2>{model.controlRecords[0].deviceName}</h2>
                  <p>{model.controlRecords[0].action}</p>
                  <small>{model.controlRecords[0].ruleName}</small>
                  <button
                    className="story-action"
                    onPointerDown={() => activateFromPointer(() => startReplayForRecord(model.controlRecords[0]))}
                    onClick={() => activateFromClick(() => startReplayForRecord(model.controlRecords[0]))}
                  >
                    <Play size={15} /> Replay in 3D
                  </button>
                </>
              ) : (
                <p className="muted">No device control records yet.</p>
              )}
            </div>
          </section>

          <section className="behavior-grid">
            <div className="story-card behavior-card">
              <span className="eyebrow">Behavior intents</span>
              <div className="behavior-list">
                {model.behaviorCards.slice(0, 4).map((card) => (
                  <button
                    key={card.personId}
                    className="behavior-row"
                    onClick={() => card.roomId === 'away' ? undefined : setFloorplanSelection({ type: 'room', id: card.roomId })}
                  >
                    <strong>{card.label}</strong>
                    <span>{card.intent}</span>
                    <small>{card.routinePhase} / {card.attentionTarget}</small>
                    <em>{card.energy}</em>
                  </button>
                ))}
              </div>
            </div>
            <div className="story-card lifecycle-card">
              <span className="eyebrow">Lifecycle queue</span>
              {model.deviceLifecycleCards.length > 0 ? (
                <div className="behavior-list">
                  {model.deviceLifecycleCards.slice(0, 3).map((card) => (
                    <button
                      key={card.deviceId}
                      className="behavior-row"
                      onClick={() => setFloorplanSelection({ type: 'device', id: card.deviceId })}
                    >
                      <strong>{card.headline}</strong>
                      <span>{card.status}</span>
                      <small>{card.roomName} / {card.nextAction}</small>
                      <em>{card.priority}</em>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">No device is waiting for household handling.</p>
              )}
            </div>
          </section>

          <DemoSpotlightPanel
            spotlight={model.demoSpotlight}
            holdUntil={demoHoldUntil}
            controlRecord={model.demoSpotlight?.controlRecordId
              ? model.controlRecords.find((record) => record.id === model.demoSpotlight?.controlRecordId) ?? null
              : null}
            onReplay={(record) => startReplayForRecord(record)}
          />
        </section>

        <section className="secondary-grid">
          <div className="panel alert-response-panel">
            <h2>Alert Response</h2>
            {model.alertWorkflows.length === 0 ? <p className="muted">No active alert workflow.</p> : model.alertWorkflows.map((workflow) => (
              <div key={workflow.alertId} className="workflow-card">
                <strong>{workflow.title}</strong>
                <span>{workflow.roomName} / {workflow.status}</span>
                <p>{workflow.recommendedAction}</p>
                <div className="workflow-actions">
                  {workflow.actions.map((action) => (
                    <button
                      key={`${workflow.alertId}-${action.kind}`}
                      className={action.highRisk ? 'danger-action' : ''}
                      disabled={workflow.lifecycleStatus === 'resolved' && action.kind !== 'evidence' && action.kind !== 'replay'}
                      onClick={() => handleAlertAction(workflow, action)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                {workflow.evidence.length > 0 ? (
                  <ul className="evidence-list">
                    {workflow.evidence.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : null}
                <ol>
                  {workflow.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </div>
            ))}
          </div>

          <div className="panel">
            <h2>Forecasts</h2>
            <div className="insight-list">
              {model.predictionCards.map((prediction) => {
                const selectedMetric = selectedForecastMetricByCard[prediction.id] ?? prediction.chart.series[0]?.metric;
                const selectedSeries = prediction.chart.series.find((series) => series.metric === selectedMetric) ?? prediction.chart.series[0];
                return (
                  <div key={prediction.id} className="insight-card watch forecast-card">
                    <div className="forecast-card-header">
                      <span>{prediction.roomName} / {prediction.horizon}</span>
                      <button type="button" onClick={() => setFloorplanSelection({ type: 'device', id: prediction.relatedDeviceId })}>Focus device</button>
                    </div>
                    <strong>{prediction.title}</strong>
                    <small>{prediction.forecast}</small>
                    <em>{prediction.ifIgnored}</em>
                    <small>{prediction.ifHandledNow}</small>
                    <div className="forecast-recovery" title={prediction.recoveryEstimate.basis}>
                      <span>{prediction.recoveryEstimate.action}</span>
                      <strong>{prediction.recoveryEstimate.estimatedRecoveryMinutes} min</strong>
                      <small>{prediction.recoveryEstimate.impactReductionPercent}% impact reduction / {prediction.recoveryEstimate.confidence} confidence</small>
                    </div>
                    {prediction.forecastPoints.length > 0 ? (
                      <div className="forecast-points">
                        {prediction.forecastPoints.map((point) => (
                          <div key={point.metric} className="forecast-point">
                            <span>
                              {point.metric.replaceAll('_', ' ')}: ignore {point.ignored.join(' -> ')} {point.unit}; handle {point.handledNow.join(' -> ')} {point.unit}
                            </span>
                            <small>{point.confidenceInterval.levelPercent}% confidence band / +/-{point.confidenceInterval.spreadPercent}%</small>
                            <div className="forecast-curve" aria-hidden="true">
                              <div className="forecast-line ignore">
                                {point.ignored.map((value, index) => (
                                  <i
                                    key={`ignored-${index}`}
                                    style={{ height: `${forecastBarHeight(value, point.ignored, point.handledNow)}%` }}
                                  />
                                ))}
                              </div>
                              <div className="forecast-line handle">
                                {point.handledNow.map((value, index) => (
                                  <i
                                    key={`handled-${index}`}
                                    style={{ height: `${forecastBarHeight(value, point.ignored, point.handledNow)}%` }}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {selectedSeries ? (
                      <div className="forecast-chart" aria-label={`${prediction.chart.title} chart`}>
                        <div className="forecast-metric-tabs" role="tablist" aria-label={`${prediction.title} metrics`}>
                          {prediction.chart.series.map((series) => (
                            <button
                              key={series.metric}
                              type="button"
                              className={series.metric === selectedSeries.metric ? 'active' : ''}
                              onClick={() => setSelectedForecastMetricByCard((current) => ({ ...current, [prediction.id]: series.metric }))}
                            >
                              {series.label}
                            </button>
                          ))}
                        </div>
                        <div className="forecast-chart-axis">
                          {prediction.chart.horizonMinutes.map((minute) => <span key={minute}>{minute}m</span>)}
                        </div>
                        <div className="forecast-chart-series">
                          <span>{selectedSeries.label} ({selectedSeries.unit})</span>
                          <div className="forecast-chart-lines">
                            <div className="forecast-chart-line ignore">
                              {selectedSeries.ignored.map((value, index) => (
                                <i key={`chart-ignore-${index}`} style={{ height: `${forecastBarHeight(value, selectedSeries.ignored, selectedSeries.handledNow)}%` }} />
                              ))}
                            </div>
                            <div className="forecast-chart-line handle">
                              {selectedSeries.handledNow.map((value, index) => (
                                <i key={`chart-handle-${index}`} style={{ height: `${forecastBarHeight(value, selectedSeries.ignored, selectedSeries.handledNow)}%` }} />
                              ))}
                            </div>
                          </div>
                          <small>
                            {selectedSeries.confidenceInterval.levelPercent}% band: ignore {selectedSeries.confidenceInterval.ignoredLow.at(-1)}-{selectedSeries.confidenceInterval.ignoredHigh.at(-1)} {selectedSeries.unit}; handle {selectedSeries.confidenceInterval.handledNowLow.at(-1)}-{selectedSeries.confidenceInterval.handledNowHigh.at(-1)} {selectedSeries.unit}
                          </small>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {model.predictionCards.length === 0 ? <p className="muted">No active forecast needs attention.</p> : null}
            </div>
          </div>

          <div className="panel">
            <h2>Home Insights</h2>
            <div className="insight-list">
              {model.insightCards.map((insight) => (
                <button
                  key={insight.id}
                  className={`insight-card ${insight.status}`}
                  onClick={() => setFloorplanSelection({ type: 'device', id: insight.relatedDeviceId })}
                >
                  <span>{insight.category.replace('_', ' ')}</span>
                  <strong>{insight.title}</strong>
                  <small>{insight.reason}</small>
                  <em>{insight.recommendedAction}</em>
                  <small>{insight.expectedEffect}</small>
                </button>
              ))}
              {model.insightCards.length === 0 ? <p className="muted">No telemetry insight needs attention.</p> : null}
            </div>
          </div>

          <div className="panel">
            <h2>Device Health</h2>
            <div className="insight-list">
              {model.deviceHealthCards.map((card) => (
                <button
                  key={card.id}
                  className={`insight-card ${card.status}`}
                  onClick={() => setFloorplanSelection({ type: 'device', id: card.focusDeviceId })}
                >
                  <span>{card.roomName} / {card.maintenanceLabel}</span>
                  <strong>{card.displayName} {card.signal.toLowerCase()}</strong>
                  <small>{card.sourceField ?? 'device'}: {String(card.reportedValue)}</small>
                  <em>{card.recommendedAction}</em>
                  <small>{card.expectedEffect}</small>
                </button>
              ))}
              {model.deviceHealthCards.length === 0 ? <p className="muted">No device health item needs attention.</p> : null}
            </div>
          </div>

          {sidebarMode !== 'home' ? <TwinInferencePanel inference={model.twinInference} /> : null}
          {sidebarMode !== 'home' ? <BehaviorAuditPanel audit={model.behaviorAudit} /> : null}

          <div className="panel">
            <h2>Telemetry Trends</h2>
            <div className="trend-list">
              {model.telemetrySeries.map((series) => (
                <div key={series.id} className={`trend-row ${series.thresholdStatus}`}>
                  <div className="trend-heading">
                    <span>{series.label}</span>
                    <strong>{series.currentValue.toFixed(1)} {series.unit}</strong>
                  </div>
                  <div className="sparkline">
                    {series.points.slice(-16).map((point, index) => (
                      <i key={`${series.id}-${index}`} style={{ height: `${Math.max(8, Math.min(48, point))}px` }} />
                    ))}
                  </div>
                  <small>{series.insight} Normal: {series.normalRange[0]}-{series.normalRange[1]} {series.unit}</small>
                  {series.relatedAutomation ? <small>Automation: {series.relatedAutomation}</small> : null}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Automation Decisions</h2>
            {model.automationExplanations.length === 0 ? <p className="muted">No automation decisions yet.</p> : model.automationExplanations.slice(0, 4).map((automation) => (
              <div key={automation.id} className="decision-row">
                <time>{formatTime(automation.time)}</time>
                <strong>{automation.ruleName}</strong>
                <span>{automation.explanation}</span>
                <small>Matched: {automation.matchedFacts.join(', ')}</small>
                <ol className="decision-chain">
                  {automation.decisionChain.map((step) => (
                    <li key={`${automation.id}-${step.label}`}>
                      <b>{step.label}</b>
                      <span>{step.value}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <div className="panel event-panel">
            <h2>Timeline</h2>
            {model.recentEvents.map((event) => (
              <div key={event.id} className="event-row">
                <time>{formatTime(event.time)}</time>
                <span>{event.label}</span>
              </div>
            ))}
          </div>
        </section>

        <ControlRecordPanel
          records={model.controlRecords}
          filters={model.controlRecordFilters}
          replays={floorplanModel.eventReplays}
          onFocusDevice={(deviceId) => setFloorplanSelection({ type: 'device', id: deviceId })}
          onReplay={startReplayForRecord}
        />
        {sidebarMode === 'debug' ? <RawEventStream events={events} /> : null}
          </>
        )}
      </section>
    </main>
  );
}

function TwinInferencePanel({ inference }: { inference: ReturnType<typeof createDashboardModel>['twinInference'] }): React.ReactElement {
  return (
    <div className="panel twin-inference-panel">
      <h2>Twin Inference</h2>
      <div className="audit-summary">
        <span>{inference.inputSummary.acceptedEventCount} observations</span>
        <span>{inference.inputSummary.rejectedEventTypes.length} rejected labels</span>
        <span>{Math.round(inference.homeMode.confidence * 100)}% mode</span>
      </div>
      <div className="inference-mode-row">
        <div>
          <span>Truth</span>
          <strong>{inference.homeMode.truth}</strong>
        </div>
        <div>
          <span>Inferred</span>
          <strong>{inference.homeMode.inferred}</strong>
        </div>
      </div>
      <div className="audit-person-list">
        {inference.people.slice(0, 4).map((person) => (
          <div key={person.personId} className="audit-person-row">
            <div>
              <strong>{person.label}</strong>
              <span>{person.inferredRoom} / {person.inferredActivity}</span>
              <small>Truth: {person.truthRoom} / {person.truthActivity}</small>
            </div>
            <em>{Math.round(person.roomConfidence * 100)}%</em>
          </div>
        ))}
      </div>
      <div className="causal-list">
        {inference.risks.slice(0, 3).map((risk) => (
          <div key={risk.id} className="causal-row">
            <strong>{risk.id.replaceAll('_', ' ')}</strong>
            <span>{Math.round(risk.probability * 100)}% risk</span>
            <small>{risk.drivers.join(', ')}</small>
          </div>
        ))}
      </div>
      {inference.inputSummary.rejectedEventTypes.length > 0 ? (
        <small className="muted">Ignored truth/control labels: {inference.inputSummary.rejectedEventTypes.join(', ')}</small>
      ) : null}
    </div>
  );
}

function BehaviorAuditPanel({ audit }: { audit: ReturnType<typeof createDashboardModel>['behaviorAudit'] }): React.ReactElement {
  return (
    <div className="panel behavior-audit-panel">
      <h2>Behavior Audit</h2>
      <div className="audit-summary">
        <span>{audit.people.length} people</span>
        <span>{audit.recentCausalEvents.length} causal events</span>
        <span>{audit.unresolvedTasks.length} open tasks</span>
      </div>
      <div className="audit-person-list">
        {audit.people.slice(0, 5).map((person) => (
          <div key={person.personId} className="audit-person-row">
            <div>
              <strong>{person.label}</strong>
              <span>{person.intent} / {person.routinePhase}</span>
              <small>{person.nextPlan}</small>
            </div>
            <em>{person.energy}</em>
            {person.nextCommitment ? (
              <small>Commitment: {person.nextCommitment.activity} / {person.nextCommitment.window} / {person.nextCommitment.pressure}</small>
            ) : null}
            <small>{person.memorySummary}</small>
            {person.triggeredRules.length > 0 ? <small>Rules: {person.triggeredRules.join(', ')}</small> : null}
            {person.affectsDevices.length > 0 ? <small>Devices: {person.affectsDevices.join(', ')}</small> : null}
          </div>
        ))}
      </div>
      <div className="causal-list">
        {audit.recentCausalEvents.slice(0, 4).map((event) => (
          <div key={event.eventId} className="causal-row">
            <time>{formatTime(event.time)}</time>
            <strong>{event.ruleId ? formatRuleLabel(event.ruleId) : event.type}</strong>
            <span>{event.why}</span>
            <small>{event.actors.length > 0 ? `Actors: ${event.actors.join(', ')}` : 'Actors: system'}</small>
            <small>{event.affectedDevices.length > 0 ? `Devices: ${event.affectedDevices.join(', ')}` : event.expectedOutcome}</small>
          </div>
        ))}
      </div>
      {audit.consistencyWarnings.length > 0 ? (
        <div className="audit-warnings">
          {audit.consistencyWarnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, intent = 'normal' }: { label: string; value: number; intent?: 'normal' | 'alert' }): React.ReactElement {
  return (
    <div className={`metric ${intent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const roomOrder: RoomId[] = [
  'entrance',
  'living_room',
  'kitchen',
  'dining_room',
  'master_bedroom',
  'child_bedroom',
  'study',
  'bathroom',
  'garden'
];

const roomNames: Record<RoomId, string> = {
  entrance: 'Entrance',
  living_room: 'Living Room',
  kitchen: 'Kitchen',
  dining_room: 'Dining Room',
  master_bedroom: 'Master Bedroom',
  child_bedroom: 'Child Bedroom',
  study: 'Study',
  bathroom: 'Bathroom',
  garden: 'Garden'
};

function Floorplan2D({
  rooms,
  selected,
  onSelect,
  onSelectDevice
}: {
  rooms: ReturnType<typeof createDashboardModel>['floorplanRooms'];
  selected: RoomId | null;
  onSelect: (roomId: RoomId) => void;
  onSelectDevice: (deviceId: string) => void;
}): React.ReactElement {
  return (
    <div className="floorplan-shell floorplan2d-shell">
      <div className="floorplan">
        {roomOrder.map((roomId) => {
          const room = rooms[roomId];
          const visibleDevices = room.devices.filter((device) => device.active).slice(0, 4);
          return (
            <button
              key={roomId}
              className={`room room-${roomId} ${room.people.length > 0 ? 'occupied' : ''} ${selected === roomId ? 'selected' : ''}`}
              onClick={() => onSelect(roomId)}
            >
              <span className="room-header">
                <strong>{roomNames[roomId]}</strong>
                <span>{room.people.map((person) => person.label).join(', ') || 'Empty'}</span>
              </span>
              <span className="presence-layer">
                {room.people.slice(0, 5).map((person) => (
                  <i key={person.id} className={`person-marker person-slot-${person.slot} ${person.recent ? 'recent' : ''}`} title={person.activity}>
                    {person.label.slice(0, 1)}
                  </i>
                ))}
              </span>
              {visibleDevices.map((device) => (
                <span
                  key={device.id}
                  className={`device-marker active device-slot-${device.slot}`}
                  title={device.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectDevice(device.id);
                  }}
                >
                  {device.label}
                </span>
              ))}
              <em className="room-active-count">{room.activeDeviceCount} active</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DemoSpotlightPanel({
  spotlight,
  holdUntil,
  controlRecord,
  onReplay
}: {
  spotlight: ReturnType<typeof createDashboardModel>['demoSpotlight'];
  holdUntil: string | null;
  controlRecord: ReturnType<typeof createDashboardModel>['controlRecords'][number] | null;
  onReplay: (record: ReturnType<typeof createDashboardModel>['controlRecords'][number]) => void;
}): React.ReactElement {
  if (!spotlight) {
    return (
      <section className="panel demo-spotlight idle">
        <span className="eyebrow">Demo spotlight</span>
        <h2>Whole-home overview</h2>
        <p className="muted">Select a scenario script to focus the 3D twin on the next explainable event.</p>
      </section>
    );
  }

  return (
    <section className={`panel demo-spotlight ${spotlight.kind}`}>
      <div>
        <span className="eyebrow">Demo spotlight</span>
        <h2>{spotlight.headline}</h2>
        <p>{spotlight.summary}</p>
      </div>
      <div className="demo-spotlight-meta">
        <span>{spotlight.roomName}</span>
        <span>{spotlight.kind === 'automation' ? 'Automation replay' : spotlight.kind}</span>
        {holdUntil ? <span>Paused 2s</span> : <span>Live</span>}
      </div>
      {controlRecord ? (
        <button className="story-action" onPointerDown={() => onReplay(controlRecord)} onClick={() => onReplay(controlRecord)}>
          <Play size={15} /> Replay linked record
        </button>
      ) : null}
    </section>
  );
}

function ControlRecordPanel({
  records,
  filters,
  replays,
  onFocusDevice,
  onReplay
}: {
  records: ReturnType<typeof createDashboardModel>['controlRecords'];
  filters: ReturnType<typeof createDashboardModel>['controlRecordFilters'];
  replays: FloorplanEventReplay[];
  onFocusDevice: (deviceId: string) => void;
  onReplay: (record: ReturnType<typeof createDashboardModel>['controlRecords'][number]) => void;
}): React.ReactElement {
  const [roomFilter, setRoomFilter] = React.useState('all');
  const [ruleFilter, setRuleFilter] = React.useState('all');
  const [deviceFilter, setDeviceFilter] = React.useState('all');
  const [personFilter, setPersonFilter] = React.useState('all');
  const [scenarioFilter, setScenarioFilter] = React.useState('all');
  const [alertFilter, setAlertFilter] = React.useState('all');
  const [timeWindow, setTimeWindow] = React.useState('all');
  const pointerActivationRef = React.useRef(false);
  const filteredRecords = records.filter((record) => (
    (roomFilter === 'all' || record.roomName === roomFilter) &&
    (ruleFilter === 'all' || record.ruleName === ruleFilter) &&
    (deviceFilter === 'all' || record.deviceName === deviceFilter) &&
    (personFilter === 'all' || record.people.includes(personFilter)) &&
    (scenarioFilter === 'all' || record.scenarioId === scenarioFilter) &&
    (alertFilter === 'all' || record.alertSeverity === alertFilter) &&
    recordMatchesTimeWindow(record.time, records[0]?.time, timeWindow)
  ));

  function exportRecords(format: 'json' | 'csv'): void {
    const content = format === 'json' ? JSON.stringify(filteredRecords, null, 2) : toCsv(filteredRecords);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `virtualhome-control-records.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyLatest(): Promise<void> {
    const latest = filteredRecords[0];
    if (!latest) return;
    await navigator.clipboard.writeText(JSON.stringify(latest, null, 2));
  }

  async function copyRecordPayload(record: ReturnType<typeof createDashboardModel>['controlRecords'][number]): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(record.payload, null, 2));
  }

  function activateFromPointer(action: () => void): void {
    pointerActivationRef.current = true;
    action();
  }

  function activateFromClick(action: () => void): void {
    if (pointerActivationRef.current) {
      pointerActivationRef.current = false;
      return;
    }
    action();
  }

  return (
    <section className="panel records-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Auditable output</span>
          <h2>Device Control Records</h2>
        </div>
        <div className="panel-actions">
          <button onClick={() => exportRecords('json')}><FileDown size={15} /> JSON</button>
          <button onClick={() => exportRecords('csv')}><FileDown size={15} /> CSV</button>
          <button onClick={() => copyLatest()}><Copy size={15} /> Copy latest</button>
          {filteredRecords[0] ? (
            <button
              onPointerDown={() => activateFromPointer(() => onReplay(filteredRecords[0]))}
              onClick={() => activateFromClick(() => onReplay(filteredRecords[0]))}
            >
              <Play size={15} /> Replay latest
            </button>
          ) : null}
        </div>
      </div>
      <div className="record-filters">
        <label>
          Room
          <select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}>
            <option value="all">All rooms</option>
            {filters.rooms.map((room) => <option key={room} value={room}>{room}</option>)}
          </select>
        </label>
        <label>
          Rule
          <select value={ruleFilter} onChange={(event) => setRuleFilter(event.target.value)}>
            <option value="all">All rules</option>
            {filters.rules.map((rule) => <option key={rule} value={rule}>{rule}</option>)}
          </select>
        </label>
        <label>
          Device
          <select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}>
            <option value="all">All devices</option>
            {filters.devices.map((device) => <option key={device} value={device}>{device}</option>)}
          </select>
        </label>
        <label>
          Person
          <select value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}>
            <option value="all">All people</option>
            {filters.people.map((person) => <option key={person} value={person}>{person}</option>)}
          </select>
        </label>
        <label>
          Scenario
          <select value={scenarioFilter} onChange={(event) => setScenarioFilter(event.target.value)}>
            <option value="all">All scenarios</option>
            {filters.scenarios.map((scenario) => <option key={scenario} value={scenario}>{scenario}</option>)}
          </select>
        </label>
        <label>
          Alert
          <select value={alertFilter} onChange={(event) => setAlertFilter(event.target.value)}>
            <option value="all">All severities</option>
            {filters.alertSeverities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
        </label>
        <label>
          Time
          <select value={timeWindow} onChange={(event) => setTimeWindow(event.target.value)}>
            <option value="all">Full range</option>
            <option value="15">Last 15 min</option>
            <option value="60">Last 60 min</option>
          </select>
        </label>
      </div>
      {filters.timeRange ? (
        <p className="record-range">Showing records from {formatTime(filters.timeRange.from)} to {formatTime(filters.timeRange.to)}</p>
      ) : null}
      <div className="records-table" role="table" aria-label="Device control records">
        <div className="records-head" role="row">
          <span>Time</span>
          <span>Device</span>
          <span>Rule</span>
          <span>State change</span>
          <span>Trigger</span>
          <span>Actions</span>
        </div>
        {filteredRecords.slice(0, 10).map((record) => (
          <details key={record.id} className="record-entry">
            <summary className="record-row" role="row">
              <time>{formatTime(record.time)}</time>
              <strong>{record.deviceName}<small>{record.roomName}</small></strong>
              <span>{record.ruleName}</span>
              <code>{record.previousState}{' -> '}{record.nextState}</code>
              <span>{record.trigger}</span>
              <span className="record-row-actions">
                <button
                  type="button"
                  aria-label={`Focus ${record.deviceName}`}
                  onPointerDown={() => {
                    activateFromPointer(() => onFocusDevice(record.deviceId));
                  }}
                  onClick={() => {
                    activateFromClick(() => onFocusDevice(record.deviceId));
                  }}
                >
                  Focus
                </button>
              </span>
            </summary>
            <div className="record-detail">
              <div>
                <strong>Actor</strong>
                <span>{record.actor}</span>
              </div>
              <div>
                <strong>People</strong>
                <span>{record.people.join(', ') || 'No person associated'}</span>
              </div>
              <div>
                <strong>Scenario</strong>
                <span>{record.scenarioId}</span>
              </div>
              <div>
                <strong>Alert severity</strong>
                <span>{record.alertSeverity ?? 'None'}</span>
              </div>
              <div>
                <strong>3D replay</strong>
                <span>{hasReplayForRecord(record, replays) ? 'Replay available' : 'Focus device only'}</span>
              </div>
              <button
                onPointerDown={() => activateFromPointer(() => onReplay(record))}
                onClick={() => activateFromClick(() => onReplay(record))}
              >
                <Play size={15} /> Replay in 3D
              </button>
              <button onClick={() => copyRecordPayload(record)}><Copy size={15} /> Copy payload</button>
            </div>
          </details>
        ))}
        {filteredRecords.length === 0 ? <p className="muted">No matching device control records.</p> : null}
      </div>
    </section>
  );
}

function ReplayPanel({
  replay,
  activeStepIndex,
  activeStepId,
  onStepSelect,
  onNext,
  onClose
}: {
  replay: FloorplanEventReplay | null;
  activeStepIndex: number;
  activeStepId: string | null;
  onStepSelect: (stepIndex: number) => void;
  onNext: () => void;
  onClose: () => void;
}): React.ReactElement {
  const pointerActivationRef = React.useRef(false);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);

  React.useEffect(() => {
    if (!playing || !replay) return;
    if (activeStepIndex >= replay.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(onNext, 1200 / speed);
    return () => window.clearTimeout(timer);
  }, [activeStepIndex, onNext, playing, replay, speed]);

  function activateFromPointer(action: () => void): void {
    pointerActivationRef.current = true;
    action();
  }

  function activateFromClick(action: () => void): void {
    if (pointerActivationRef.current) {
      pointerActivationRef.current = false;
      return;
    }
    action();
  }

  if (!replay) {
    return (
      <div className="panel replay-panel idle">
        <span className="eyebrow">3D event replay</span>
        <h2>Ready to replay</h2>
        <p className="muted">Open a control record and choose Replay in 3D.</p>
      </div>
    );
  }

  const activeStep = replay.steps[activeStepIndex] ?? replay.steps[0];
  const shareReplay = replay;

  async function copyShareReport(): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(buildReplayShareReport(shareReplay), null, 2));
  }

  return (
    <div className={`panel replay-panel ${replay.severity}`}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">3D event replay</span>
          <h2>{replay.ruleId.replaceAll('_', ' ')}</h2>
        </div>
        <div className="panel-actions">
          <button onClick={() => setPlaying((current) => !current)}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Replay speed">
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
          </select>
          <button
            onPointerDown={() => activateFromPointer(onNext)}
            onClick={() => activateFromClick(onNext)}
            disabled={activeStepIndex >= replay.steps.length - 1}
          >
            <StepForward size={15} /> Next
          </button>
          <button
            onPointerDown={() => activateFromPointer(onClose)}
            onClick={() => activateFromClick(onClose)}
          >
            Close
          </button>
          <button onClick={() => void copyShareReport()}><Copy size={15} /> Share</button>
        </div>
      </div>
      <p>{activeStep.label}: {activeStep.detail}</p>
      <ReplayStateEvidence step={activeStep} />
      <ReplayDeviceTimelines replay={replay} />
      <input
        className="replay-timeline"
        type="range"
        min={0}
        max={replay.steps.length - 1}
        value={activeStepIndex}
        onChange={(event) => onStepSelect(Number(event.target.value))}
        aria-label="Replay timeline"
      />
      <div className="replay-steps" role="list" aria-label="3D event replay steps">
        {replay.steps.map((step, index) => (
          <button
            key={step.id}
            className={activeStepId === step.id ? 'active' : ''}
            role="listitem"
            onPointerDown={() => activateFromPointer(() => onStepSelect(index))}
            onClick={() => activateFromClick(() => onStepSelect(index))}
          >
            <strong>{index + 1}</strong>
            <span>{step.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReplayDeviceTimelines({ replay }: { replay: FloorplanEventReplay }): React.ReactElement | null {
  if (replay.deviceTimelines.length === 0) {
    return null;
  }

  return (
    <div className="replay-state-evidence" aria-label="Replay device timelines">
      {replay.deviceTimelines.map((timeline) => (
        <div key={timeline.deviceId}>
          <strong>{timeline.displayName} / {timeline.role}</strong>
          <code>{timeline.entries.map((entry) => `${entry.phase}: ${formatReplayState(entry.state)}`).join(' -> ')}</code>
        </div>
      ))}
    </div>
  );
}

function ReplayStateEvidence({ step }: { step: FloorplanEventReplay['steps'][number] }): React.ReactElement | null {
  const previousState = formatReplayState(step.previousState);
  const nextState = formatReplayState(step.nextState);
  const snapshot = formatReplayState(step.stateSnapshot);

  if (!previousState && !nextState && !snapshot && !step.commandStatus && !step.commandReason) {
    return null;
  }

  return (
    <div className="replay-state-evidence" aria-label="Replay state evidence">
      {step.commandStatus ? (
        <div>
          <strong>Status</strong>
          <code>{step.commandStatus}{step.commandReason ? ` / ${step.commandReason}` : ''}</code>
        </div>
      ) : null}
      {previousState ? (
        <div>
          <strong>Before</strong>
          <code>{previousState}</code>
        </div>
      ) : null}
      {nextState ? (
        <div>
          <strong>After</strong>
          <code>{nextState}</code>
        </div>
      ) : null}
      {snapshot && snapshot !== nextState ? (
        <div>
          <strong>Snapshot</strong>
          <code>{snapshot}</code>
        </div>
      ) : null}
    </div>
  );
}

function formatReplayState(state: FloorplanEventReplay['steps'][number]['stateSnapshot']): string {
  if (!state) return '';
  return Object.entries(state)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function hasReplayForRecord(
  record: ReturnType<typeof createDashboardModel>['controlRecords'][number],
  replays: FloorplanEventReplay[]
): boolean {
  if (!record.reason.startsWith('rule:')) return false;
  const ruleId = record.reason.slice('rule:'.length);
  return replays.some((replay) => replay.ruleId === ruleId);
}

function SelectionPanel({
  room,
  device,
  snapshotDevice,
  deviceControlCard,
  roomOccupants,
  roomDevices,
  focusDevices,
  roomRecords,
  activeDeviceCount,
  occupiedRoomCount,
  onSelectDevice,
  onCommand
}: {
  room: Floorplan3DRoom | null;
  device: Floorplan3DDevice | null;
  snapshotDevice: DeviceState | null;
  deviceControlCard: ReturnType<typeof createDashboardModel>['deviceControlCards'][number] | null;
  roomOccupants: ReturnType<typeof createDashboardModel>['floorplanRooms'][keyof ReturnType<typeof createDashboardModel>['floorplanRooms']]['people'];
  roomDevices: ReturnType<typeof createDashboardModel>['floorplanRooms'][keyof ReturnType<typeof createDashboardModel>['floorplanRooms']]['devices'];
  focusDevices: ReturnType<typeof createDashboardModel>['floorplanRooms'][keyof ReturnType<typeof createDashboardModel>['floorplanRooms']]['devices'];
  roomRecords: ReturnType<typeof createDashboardModel>['controlRecords'];
  activeDeviceCount: number;
  occupiedRoomCount: number;
  onSelectDevice: (deviceId: string) => void;
  onCommand: (deviceId: string, command: string, value: DeviceCommandValue) => void;
}): React.ReactElement {
  if (device && snapshotDevice) {
    return (
      <div className="panel selection-panel">
        <span className="eyebrow">Selected device</span>
        <h2>{device.displayName}</h2>
        <div className="detail-list">
          <Detail label="Device ID" value={device.id} />
          <Detail label="Room" value={device.roomId.replace('_', ' ')} />
          <Detail label="Group" value={device.instanceGroup.replaceAll('_', ' ')} />
          <Detail label="Privacy" value={device.privacyLevel} intent={device.privacyLevel === 'private' ? 'alert' : 'normal'} />
          <Detail label="Risk" value={device.riskLevel.replaceAll('_', ' ')} intent={device.riskLevel === 'high' || device.riskLevel === 'privacy_sensitive' ? 'alert' : 'normal'} />
          <Detail label="Marker" value={`${device.markerKind} / ${device.animationHint}`} />
          <Detail label="Status" value={device.abnormal ? `Attention needed: ${device.statusLabel}` : device.active ? `Active: ${device.statusLabel}` : device.statusLabel} intent={device.abnormal ? 'alert' : 'normal'} />
          <Detail label="Operability" value={device.interactionHint} intent={device.operability === 'offline' ? 'alert' : 'normal'} />
          <Detail label="State" value={summarizeState(snapshotDevice.state)} />
          {deviceControlCard ? <Detail label="Command state" value={deviceControlCard.commandStatus} intent={deviceControlCard.connectivity === 'offline' ? 'alert' : 'normal'} /> : null}
        </div>
        {deviceControlCard ? <DeviceRecentEvents card={deviceControlCard} /> : null}
        {deviceControlCard ? (
          <DeviceControlCardView card={deviceControlCard} onCommand={onCommand} />
        ) : null}
      </div>
    );
  }

  if (room) {
    return (
      <div className="panel selection-panel">
        <span className="eyebrow">Selected room</span>
        <h2>{room.label}</h2>
        <div className="detail-list">
          <Detail label="Occupancy" value={room.occupied ? 'Occupied' : 'Empty'} />
          <Detail label="Lighting" value={room.lit ? 'On' : 'Off'} />
          <Detail label="Climate" value={`${room.temperatureC.toFixed(1)}C / ${room.humidityPercent.toFixed(0)}%`} />
          <Detail label="Occupants" value={roomOccupants.length > 0 ? roomOccupants.map((person) => `${person.label} (${person.activity.replaceAll('_', ' ')})`).join(', ') : 'None'} />
          <Detail label="Active devices" value={roomDevices.filter((item) => item.active).map((item) => item.label).join(', ') || 'None'} />
          <Detail label="Recent action" value={roomRecords[0]?.action ?? 'No recent control record'} />
          <Detail label="Risk" value={room.alertSeverity ? 'Needs attention' : room.occupied ? 'Normal occupied room' : 'Normal'} intent={room.alertSeverity ? 'alert' : 'normal'} />
          {room.alertSeverity ? <Detail label="Alert" value={room.alertSeverity} intent="alert" /> : null}
        </div>
        <DeviceFocusList devices={roomDevices} onSelectDevice={onSelectDevice} />
      </div>
    );
  }

  const overviewFocusDevice = focusDevices.find((item) => item.active) ?? focusDevices[0] ?? null;

  return (
    <div className="panel selection-panel">
      <span className="eyebrow">Home overview</span>
      <h2>Interactive twin view</h2>
      <div className="detail-list">
        <Detail label="Occupied rooms" value={String(occupiedRoomCount)} />
        <Detail label="Active devices" value={String(activeDeviceCount)} />
        <Detail label="Selection" value="Click a room or device" />
      </div>
      {overviewFocusDevice ? (
        <button className="secondary-action" onClick={() => onSelectDevice(overviewFocusDevice.id)}>
          Focus device: {overviewFocusDevice.label}
        </button>
      ) : null}
    </div>
  );
}

function DeviceFocusList({
  devices,
  onSelectDevice
}: {
  devices: ReturnType<typeof createDashboardModel>['floorplanRooms'][keyof ReturnType<typeof createDashboardModel>['floorplanRooms']]['devices'];
  onSelectDevice: (deviceId: string) => void;
}): React.ReactElement | null {
  if (devices.length === 0) {
    return null;
  }

  return (
    <div className="device-focus-list" aria-label="Room device focus actions">
      <strong>Focus device</strong>
      <div>
        {devices.slice(0, 6).map((device) => (
          <button
            key={device.id}
            className={device.active ? 'active' : ''}
            title={`${device.label}: ${device.summary}`}
            onClick={() => onSelectDevice(device.id)}
          >
            {device.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Detail({ label, value, intent = 'normal' }: { label: string; value: string; intent?: 'normal' | 'alert' }): React.ReactElement {
  return (
    <div className={`detail-row ${intent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DeviceRecentEvents({
  card
}: {
  card: ReturnType<typeof createDashboardModel>['deviceControlCards'][number];
}): React.ReactElement {
  return (
    <div className="device-recent-events">
      <div className="device-control-heading">
        <strong>Recent events</strong>
        <span>{card.lastEventAt ? formatTime(card.lastEventAt) : 'No event observed'}</span>
      </div>
      {card.recentEvents.length === 0 ? <p className="muted">No recent device event.</p> : null}
      {card.recentEvents.map((event) => (
        <div key={event.id} className="device-event-row">
          <time>{formatTime(event.time)}</time>
          <span>{event.type === 'DeviceTelemetry' ? 'Telemetry' : 'State'}</span>
          <code>{event.label}</code>
          {event.reason ? <small>{event.reason}</small> : null}
        </div>
      ))}
    </div>
  );
}

function DeviceControlCardView({
  card,
  onCommand
}: {
  card: ReturnType<typeof createDashboardModel>['deviceControlCards'][number];
  onCommand: (deviceId: string, command: string, value: DeviceCommandValue) => void;
}): React.ReactElement {
  const [draftValues, setDraftValues] = React.useState<Record<string, DeviceCommandValue>>({});

  function valueFor(command: ReturnType<typeof createDashboardModel>['deviceControlCards'][number]['controls'][number]): DeviceCommandValue {
    return draftValues[command.command] ?? command.value ?? command.min ?? null;
  }

  function executeControl(command: ReturnType<typeof createDashboardModel>['deviceControlCards'][number]['controls'][number], value: DeviceCommandValue): void {
    if (!confirmDeviceCommand({
      displayName: card.displayName,
      label: command.label,
      highRisk: command.highRisk,
      requiresConfirmation: command.requiresConfirmation,
      disabled: command.disabled
    })) {
      return;
    }
    onCommand(card.deviceId, command.command, value);
  }

  return (
    <div className="device-control-card">
      <div className="device-control-heading">
        <strong>Controls</strong>
        <span>{card.connectivity === 'offline' ? card.disabledReason : card.commandStatus}</span>
      </div>
      {card.commandTimeline.length > 0 ? (
        <div className="command-timeline" aria-label="Command lifecycle timeline">
          {card.commandTimeline.map((entry) => (
            <span key={`${entry.status}:${entry.at}`}>
              <strong>{entry.status}</strong>
              <time>{formatTime(entry.at)}</time>
            </span>
          ))}
        </div>
      ) : null}
      {card.controls.length === 0 ? <p className="muted">This device exposes no commands.</p> : null}
      {card.controls.map((control) => {
        const currentValue = valueFor(control);
        if (control.controlType === 'slider') {
          return (
            <label key={control.command} className="command-control slider-command">
              <span>{control.label}</span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                value={Number(currentValue ?? control.min ?? 0)}
                disabled={control.disabled}
                onChange={(event) => setDraftValues((current) => ({ ...current, [control.command]: Number(event.target.value) }))}
              />
              <button disabled={control.disabled} onClick={() => executeControl(control, currentValue)}>
                Apply {String(currentValue)}
              </button>
            </label>
          );
        }
        if (control.controlType === 'select') {
          return (
            <label key={control.command} className="command-control">
              <span>{control.label}</span>
              <select
                value={String(currentValue ?? '')}
                disabled={control.disabled}
                onChange={(event) => setDraftValues((current) => ({ ...current, [control.command]: event.target.value }))}
              >
                {(control.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <button disabled={control.disabled} onClick={() => executeControl(control, currentValue)}>
                Apply
              </button>
            </label>
          );
        }
        return (
          <button
            key={control.command}
            className={`command-button ${control.highRisk || control.requiresConfirmation ? 'danger-action' : ''}`}
            disabled={control.disabled}
            title={control.disabledReason ?? control.label}
            onClick={() => executeControl(control, currentValue)}
          >
            {control.label}
          </button>
        );
      })}
    </div>
  );
}

function RawEventStream({ events }: { events: TwinEvent[] }): React.ReactElement {
  return (
    <section className="panel raw-events-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Debug mode</span>
          <h2>Raw Event Stream</h2>
        </div>
      </div>
      <div className="raw-event-list">
        {events.slice(-12).reverse().map((event) => (
          <details key={event.id} className="raw-event-row">
            <summary>
              <time>{formatTime(event.simTime)}</time>
              <strong>{event.type}</strong>
              <span>{event.id}</span>
            </summary>
            <pre>{JSON.stringify(event, null, 2)}</pre>
          </details>
        ))}
      </div>
    </section>
  );
}

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function formatApiActionError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.message} (${error.status})`;
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' ? 'Request timed out. Please retry.' : error.message;
  }
  return 'Request failed. Please retry.';
}

function socketStatusLabel(status: 'connecting' | 'live' | 'reconnecting' | 'offline'): string {
  if (status === 'live') return 'WS live';
  if (status === 'reconnecting') return 'WS reconnecting';
  if (status === 'offline') return 'WS offline';
  return 'WS connecting';
}

function forecastBarHeight(value: number, ignored: number[], handledNow: number[]): number {
  const values = [...ignored, ...handledNow];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return 55;
  }
  return Math.round(22 + (value - min) / (max - min) * 68);
}

function summarizeState(state: Record<string, string | number | boolean | null>): string {
  return Object.entries(state).slice(0, 3).map(([key, value]) => `${key}:${String(value)}`).join(' ');
}

function toCsv(records: ReturnType<typeof createDashboardModel>['controlRecords']): string {
  const headers = ['time', 'deviceId', 'deviceName', 'roomName', 'actor', 'ruleName', 'previousState', 'nextState', 'action', 'trigger', 'reason'];
  const rows = records.map((record) => headers.map((header) => csvCell(String(record[header as keyof typeof record]))).join(','));
  return [headers.join(','), ...rows].join('\n');
}

function recordMatchesTimeWindow(recordTime: string, latestTime: string | undefined, timeWindow: string): boolean {
  if (timeWindow === 'all' || !latestTime) {
    return true;
  }
  const minutes = Number(timeWindow);
  if (!Number.isFinite(minutes)) {
    return true;
  }
  return new Date(latestTime).getTime() - new Date(recordTime).getTime() <= minutes * 60 * 1000;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRuleLabel(ruleId: string): string {
  return ruleId
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

createRoot(document.getElementById('root')!).render(<App />);
