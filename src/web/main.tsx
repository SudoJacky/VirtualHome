import React from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, CalendarDays, Clock, Home, Pause, Radar, Shuffle, StepForward, Zap } from 'lucide-react';
import type { DeviceState, TwinEvent, TwinSnapshot } from '../shared/types';
import { Floorplan3D, type FloorplanLayers, type FloorplanSelection } from './Floorplan3D';
import { createFloorplan3DModel, type Floorplan3DDevice, type Floorplan3DRoom } from './floorplan3dModel';
import { createDashboardModel, mergeTwinEvents } from './viewModel';
import './styles.css';

interface ApiUpdate {
  snapshot: TwinSnapshot;
  events: TwinEvent[];
}

function App(): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<TwinSnapshot | null>(null);
  const [events, setEvents] = React.useState<TwinEvent[]>([]);
  const [dailyDate, setDailyDate] = React.useState(() => todayInShanghai());
  const [dailySeed, setDailySeed] = React.useState(20260617);
  const [floorplanLayers, setFloorplanLayers] = React.useState<FloorplanLayers>({
    people: true,
    devices: true,
    environment: false,
    alerts: true
  });
  const [floorplanSelection, setFloorplanSelection] = React.useState<FloorplanSelection>(null);

  React.useEffect(() => {
    void fetch('/api/state').then((response) => response.json()).then(setSnapshot);
    void fetch('/api/events?limit=80').then((response) => response.json()).then(setEvents);
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    ws.addEventListener('message', (message) => {
      const update = JSON.parse(message.data) as { snapshot: TwinSnapshot; events: TwinEvent[] };
      setSnapshot(update.snapshot);
      setEvents((current) => mergeTwinEvents(current, update.events));
    });
    return () => ws.close();
  }, []);

  async function startDailySimulation(): Promise<void> {
    const update = await postUpdate('/api/daily/start', { date: dailyDate, seed: dailySeed });
    applyUpdate(update);
  }

  async function advance(minutes: number): Promise<void> {
    const update = await postUpdate('/api/control/advance', { minutes });
    applyUpdate(update);
  }

  async function inject(kind: string): Promise<void> {
    const update = await postUpdate('/api/control/inject', { kind });
    applyUpdate(update);
  }

  async function setPaused(paused: boolean): Promise<void> {
    const update = await postUpdate(paused ? '/api/control/pause' : '/api/control/resume', {});
    applyUpdate(update);
  }

  function applyUpdate(update: ApiUpdate): void {
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
          <button onClick={() => startDailySimulation()}><CalendarDays size={16} /> Generate day</button>
        </section>

        <section className="control-group">
          <h2>Control</h2>
          <button onClick={() => advance(1)}><StepForward size={16} /> +1 min</button>
          <button onClick={() => advance(15)}><Zap size={16} /> +15 min</button>
          <button onClick={() => setPaused(!snapshot.simClock.paused)}>
            <Pause size={16} /> {snapshot.simClock.paused ? 'Resume' : 'Pause'}
          </button>
        </section>

        <section className="control-group">
          <h2>Inject</h2>
          <button onClick={() => inject('fridge_left_open')}><Bell size={16} /> Fridge open</button>
          <button onClick={() => inject('door_left_open')}><Bell size={16} /> Door open</button>
          <button onClick={() => inject('network_offline')}><Bell size={16} /> Network off</button>
          <button onClick={() => inject('senior_no_activity')}><Radar size={16} /> No activity</button>
        </section>
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
          </div>
        </header>

        <section className="metric-row">
          <Metric label="People home" value={model.occupancyCount} />
          <Metric label="Occupied rooms" value={model.occupiedRooms.length} />
          <Metric label="Active devices" value={model.activeDeviceCount} />
          <Metric label="Alerts" value={model.alerts.length} intent={model.alerts.length > 0 ? 'alert' : 'normal'} />
        </section>

        <section className="main-grid">
          <Floorplan3D
            model={floorplanModel}
            layers={floorplanLayers}
            selected={floorplanSelection}
            onToggleLayer={toggleFloorplanLayer}
            onSelect={setFloorplanSelection}
          />

          <SelectionPanel
            room={selectedRoom}
            device={selectedDevice}
            snapshotDevice={selectedDevice ? snapshot.devices[selectedDevice.id] : null}
            activeDeviceCount={model.activeDeviceCount}
            occupiedRoomCount={model.occupiedRooms.length}
            onSelectDevice={(deviceId) => setFloorplanSelection({ type: 'device', id: deviceId })}
          />

          <div className="panel">
            <h2>Alerts</h2>
            {model.alerts.length === 0 ? <p className="muted">No active alerts.</p> : model.alerts.map((alert) => (
              <button key={alert.id} className="alert-row alert-action" onClick={() => setFloorplanSelection({ type: 'room', id: alert.roomId })}>
                <strong>{alert.message}</strong>
                <span>{alert.severity} / {alert.recommendedAction}</span>
              </button>
            ))}
          </div>

          <div className="panel">
            <h2>Telemetry Trends</h2>
            <div className="trend-list">
              {model.telemetrySeries.map((series) => (
                <div key={series.id} className="trend-row">
                  <span>{series.label}</span>
                  <div className="sparkline">
                    {series.points.slice(-16).map((point, index) => (
                      <i key={`${series.id}-${index}`} style={{ height: `${Math.max(8, Math.min(48, point))}px` }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
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

function SelectionPanel({
  room,
  device,
  snapshotDevice,
  activeDeviceCount,
  occupiedRoomCount,
  onSelectDevice
}: {
  room: Floorplan3DRoom | null;
  device: Floorplan3DDevice | null;
  snapshotDevice: DeviceState | null;
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

async function postUpdate(url: string, payload: unknown): Promise<ApiUpdate> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json() as Promise<ApiUpdate>;
}

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function summarizeState(state: Record<string, string | number | boolean | null>): string {
  return Object.entries(state).slice(0, 3).map(([key, value]) => `${key}:${String(value)}`).join(' ');
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

createRoot(document.getElementById('root')!).render(<App />);
