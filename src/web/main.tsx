import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bell,
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
import { ApiClientError, postUpdate, type ApiUpdate } from './apiClient';
import { createFloorplan3DModel, type Floorplan3DDevice, type Floorplan3DRoom } from './floorplan3dModel';
import { buildTwinSocketUrl, cursorFromSnapshot, cursorFromUpdate, nextReconnectDelayMs, parseTwinSocketMessage, type TwinSocketCursor } from './twinSocket';
import { createDashboardModel, mergeTwinEvents } from './viewModel';
import './styles.css';

function App(): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<TwinSnapshot | null>(null);
  const [events, setEvents] = React.useState<TwinEvent[]>([]);
  const [sidebarMode, setSidebarMode] = React.useState<'demo' | 'debug'>('demo');
  const [floorplanView, setFloorplanView] = React.useState<'3d' | '2d'>('3d');
  const [dailyDate, setDailyDate] = React.useState(() => todayInShanghai());
  const [dailySeed, setDailySeed] = React.useState(20260617);
  const [floorplanLayers, setFloorplanLayers] = React.useState<FloorplanLayers>({
    people: true,
    devices: true,
    environment: false,
    alerts: true
  });
  const [floorplanSelection, setFloorplanSelection] = React.useState<FloorplanSelection>(null);
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [failedAction, setFailedAction] = React.useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [socketStatus, setSocketStatus] = React.useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [lastHeartbeatAt, setLastHeartbeatAt] = React.useState<string | null>(null);
  const socketCursorRef = React.useRef<TwinSocketCursor | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;

    async function refreshSnapshotFromApi(): Promise<void> {
      const response = await fetch('/api/state');
      if (!response.ok) {
        throw new Error(`State refresh failed with ${response.status}`);
      }
      const state = await response.json() as TwinSnapshot;
      if (disposed) return;
      socketCursorRef.current = cursorFromSnapshot(state);
      setSnapshot(state);
    }

    void refreshSnapshotFromApi().catch(() => {
      if (!disposed) {
        setSocketStatus('offline');
      }
    });
    void fetch('/api/events?limit=80').then((response) => response.json()).then(setEvents);

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
          socketCursorRef.current = { runId: update.runId, sequence: update.sequence };
          setLastHeartbeatAt(update.ts);
          setSocketStatus('live');
          return;
        }
        socketCursorRef.current = cursorFromUpdate(update);
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

  async function startDailySimulation(): Promise<void> {
    const update = await postUpdate('/api/daily/start', { date: dailyDate, seed: dailySeed });
    applyUpdate(update);
  }

  async function startScenarioCard(cardId: string): Promise<void> {
    if (cardId === 'weekday_normal' || cardId === 'away_day' || cardId === 'night_water_leak') {
      const update = await postUpdate(`/api/scenarios/${cardId}/start`, {});
      applyUpdate(update);
      return;
    }
    if (cardId === 'kitchen_air_quality') {
      const update = await postUpdate('/api/scenarios/weekday_normal/start', {});
      applyUpdate(update);
      const advanced = await postUpdate('/api/control/advance', { minutes: 750 });
      applyUpdate(advanced);
      return;
    }
    const injectionMap: Record<string, string> = {
      fridge_left_open: 'fridge_left_open',
      door_left_open: 'door_left_open',
      senior_no_activity: 'senior_no_activity',
      network_offline: 'network_offline'
    };
    if (injectionMap[cardId]) {
      const update = await postUpdate('/api/control/inject', { kind: injectionMap[cardId] });
      applyUpdate(update);
    }
  }

  async function advance(minutes: number): Promise<void> {
    const update = await postUpdate('/api/control/advance', { minutes });
    applyUpdate(update);
  }

  async function inject(kind: string): Promise<void> {
    const update = await postUpdate('/api/control/inject', { kind });
    applyUpdate(update);
  }

  async function resolve(kind: string): Promise<void> {
    const update = await postUpdate('/api/control/resolve', { kind });
    applyUpdate(update);
  }

  async function setPaused(paused: boolean): Promise<void> {
    const update = await postUpdate(paused ? '/api/control/pause' : '/api/control/resume', {});
    applyUpdate(update);
  }

  async function runApiAction(label: string, action: () => Promise<void>): Promise<void> {
    setPendingAction(label);
    setApiError(null);
    try {
      await action();
      setFailedAction(null);
    } catch (error) {
      setApiError(formatApiActionError(error));
      setFailedAction({ label, run: () => runApiAction(label, action) });
    } finally {
      setPendingAction(null);
    }
  }

  function applyUpdate(update: ApiUpdate): void {
    socketCursorRef.current = cursorFromSnapshot(update.snapshot);
    setSnapshot(update.snapshot);
    setEvents((current) => mergeTwinEvents(current, update.events));
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

  function toggleFloorplanLayer(layer: keyof FloorplanLayers): void {
    setFloorplanLayers((current) => ({ ...current, [layer]: !current[layer] }));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Home size={24} />
          <div>
            <strong>VirtualHome</strong>
            <span>Twin Demo</span>
          </div>
        </div>

        <div className="mode-toggle" aria-label="Console mode">
          <button className={sidebarMode === 'demo' ? 'active' : ''} onClick={() => setSidebarMode('demo')}>
            <Play size={14} /> Demo
          </button>
          <button className={sidebarMode === 'debug' ? 'active' : ''} onClick={() => setSidebarMode('debug')}>
            <Bug size={14} /> Debug
          </button>
        </div>

        {sidebarMode === 'demo' ? (
          <>
            <section className="control-group">
              <h2>Playback</h2>
              <button onClick={() => void runApiAction(snapshot.simClock.paused ? 'Resume simulation' : 'Pause simulation', () => setPaused(!snapshot.simClock.paused))}>
                {snapshot.simClock.paused ? <Play size={16} /> : <Pause size={16} />}
                {snapshot.simClock.paused ? 'Resume simulation' : 'Pause simulation'}
              </button>
              <button onClick={() => void runApiAction('Jump 15 min', () => advance(15))}><Zap size={16} /> Jump 15 min</button>
            </section>
            <section className="control-group scenario-script">
              <h2>Scenario Scripts</h2>
              {model.scenarioCards.map((scenario) => (
                <button key={scenario.id} className="scenario-card" onClick={() => void runApiAction(scenario.title, () => startScenarioCard(scenario.id))}>
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
              <button onClick={() => void runApiAction('+1 min', () => advance(1))}><StepForward size={16} /> +1 min</button>
              <button onClick={() => void runApiAction('+15 min', () => advance(15))}><Zap size={16} /> +15 min</button>
              <button onClick={() => void runApiAction(snapshot.simClock.paused ? 'Resume' : 'Pause', () => setPaused(!snapshot.simClock.paused))}>
                <Pause size={16} /> {snapshot.simClock.paused ? 'Resume' : 'Pause'}
              </button>
            </section>

            <section className="control-group">
              <h2>Inject</h2>
              <button onClick={() => void runApiAction('Fridge open', () => inject('fridge_left_open'))}><Bell size={16} /> Fridge open</button>
              <button onClick={() => void runApiAction('Door open', () => inject('door_left_open'))}><Bell size={16} /> Door open</button>
              <button onClick={() => void runApiAction('Network off', () => inject('network_offline'))}><Bell size={16} /> Network off</button>
              <button onClick={() => void runApiAction('No activity', () => inject('senior_no_activity'))}><Radar size={16} /> No activity</button>
            </section>

            <section className="control-group">
              <h2>Resolve</h2>
              <button onClick={() => void runApiAction('Resolve fridge', () => resolve('fridge_left_open'))}><Bell size={16} /> Fridge closed</button>
              <button onClick={() => void runApiAction('Resolve door', () => resolve('door_left_open'))}><Bell size={16} /> Door secured</button>
              <button onClick={() => void runApiAction('Resolve network', () => resolve('network_offline'))}><Bell size={16} /> Network online</button>
              <button onClick={() => void runApiAction('Resolve activity', () => resolve('senior_no_activity'))}><Radar size={16} /> Check-in done</button>
            </section>
          </>
        )}
      </aside>

      <section className="workspace">
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
            <div className="sim-time"><Clock size={16} /> {formatTime(model.simTime)}</div>
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
          <Metric label="Alerts" value={model.alerts.length} intent={model.alerts.length > 0 ? 'alert' : 'normal'} />
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
              </>
            ) : (
              <p className="muted">No device control records yet.</p>
            )}
          </div>
        </section>

        <section className="main-grid">
          <div className="floorplan-view">
            <div className="view-toggle" aria-label="Floorplan view">
              <button className={floorplanView === '3d' ? 'active' : ''} onClick={() => setFloorplanView('3d')}>3D</button>
              <button className={floorplanView === '2d' ? 'active' : ''} onClick={() => setFloorplanView('2d')}>2D</button>
            </div>
            {floorplanView === '3d' ? (
              <Floorplan3D
                model={floorplanModel}
                layers={floorplanLayers}
                selected={floorplanSelection}
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

          <SelectionPanel
            room={selectedRoom}
            device={selectedDevice}
            snapshotDevice={selectedDevice ? snapshot.devices[selectedDevice.id] : null}
            roomOccupants={selectedRoom ? model.floorplanRooms[selectedRoom.id].people : []}
            roomDevices={selectedRoom ? model.floorplanRooms[selectedRoom.id].devices : []}
            roomRecords={selectedRoom ? model.controlRecords.filter((record) => record.roomName === selectedRoom.label).slice(0, 3) : []}
            activeDeviceCount={model.activeDeviceCount}
            occupiedRoomCount={model.occupiedRooms.length}
            onSelectDevice={(deviceId) => setFloorplanSelection({ type: 'device', id: deviceId })}
          />

          <div className="panel">
            <h2>Alert Response</h2>
            {model.alertWorkflows.length === 0 ? <p className="muted">No active alert workflow.</p> : model.alertWorkflows.map((workflow) => (
              <div key={workflow.alertId} className="workflow-card">
                <strong>{workflow.title}</strong>
                <span>{workflow.roomName} / {workflow.status}</span>
                <ol>
                  {workflow.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </div>
            ))}
          </div>

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

        <ControlRecordPanel records={model.controlRecords} filters={model.controlRecordFilters} />
        {sidebarMode === 'debug' ? <RawEventStream events={events} /> : null}
      </section>
    </main>
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

function ControlRecordPanel({
  records,
  filters
}: {
  records: ReturnType<typeof createDashboardModel>['controlRecords'];
  filters: ReturnType<typeof createDashboardModel>['controlRecordFilters'];
}): React.ReactElement {
  const [roomFilter, setRoomFilter] = React.useState('all');
  const [ruleFilter, setRuleFilter] = React.useState('all');
  const [deviceFilter, setDeviceFilter] = React.useState('all');
  const [personFilter, setPersonFilter] = React.useState('all');
  const [scenarioFilter, setScenarioFilter] = React.useState('all');
  const [alertFilter, setAlertFilter] = React.useState('all');
  const [timeWindow, setTimeWindow] = React.useState('all');
  const [expandedRecordId, setExpandedRecordId] = React.useState<string | null>(null);
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
        </div>
        {filteredRecords.slice(0, 10).map((record) => (
          <React.Fragment key={record.id}>
            <button className="record-row record-button" role="row" onClick={() => setExpandedRecordId(expandedRecordId === record.id ? null : record.id)}>
              <time>{formatTime(record.time)}</time>
              <strong>{record.deviceName}<small>{record.roomName}</small></strong>
              <span>{record.ruleName}</span>
              <code>{record.previousState}{' -> '}{record.nextState}</code>
              <span>{record.trigger}</span>
            </button>
            {expandedRecordId === record.id ? (
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
                <button onClick={() => copyRecordPayload(record)}><Copy size={15} /> Copy payload</button>
              </div>
            ) : null}
          </React.Fragment>
        ))}
        {filteredRecords.length === 0 ? <p className="muted">No matching device control records.</p> : null}
      </div>
    </section>
  );
}

function SelectionPanel({
  room,
  device,
  snapshotDevice,
  roomOccupants,
  roomDevices,
  roomRecords,
  activeDeviceCount,
  occupiedRoomCount,
  onSelectDevice
}: {
  room: Floorplan3DRoom | null;
  device: Floorplan3DDevice | null;
  snapshotDevice: DeviceState | null;
  roomOccupants: ReturnType<typeof createDashboardModel>['floorplanRooms'][keyof ReturnType<typeof createDashboardModel>['floorplanRooms']]['people'];
  roomDevices: ReturnType<typeof createDashboardModel>['floorplanRooms'][keyof ReturnType<typeof createDashboardModel>['floorplanRooms']]['devices'];
  roomRecords: ReturnType<typeof createDashboardModel>['controlRecords'];
  activeDeviceCount: number;
  occupiedRoomCount: number;
  onSelectDevice: (deviceId: string) => void;
}): React.ReactElement {
  if (device && snapshotDevice) {
    return (
      <div className="panel selection-panel">
        <span className="eyebrow">Selected device</span>
        <h2>{device.label}</h2>
        <div className="detail-list">
          <Detail label="Device ID" value={device.id} />
          <Detail label="Room" value={device.roomId.replace('_', ' ')} />
          <Detail label="Status" value={device.abnormal ? 'Attention needed' : device.active ? 'Active' : 'Idle'} intent={device.abnormal ? 'alert' : 'normal'} />
          <Detail label="State" value={summarizeState(snapshotDevice.state)} />
        </div>
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
      </div>
    );
  }

  return (
    <div className="panel selection-panel">
      <span className="eyebrow">Home overview</span>
      <h2>Interactive twin view</h2>
      <div className="detail-list">
        <Detail label="Occupied rooms" value={String(occupiedRoomCount)} />
        <Detail label="Active devices" value={String(activeDeviceCount)} />
        <Detail label="Selection" value="Click a room or device" />
      </div>
      <button className="secondary-action" onClick={() => onSelectDevice('tv_01')}>Focus TV</button>
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

createRoot(document.getElementById('root')!).render(<App />);
