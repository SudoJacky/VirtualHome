import React from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Bell, Clock, Home, Pause, Play, Radar, StepForward, Zap } from 'lucide-react';
import type { RoomId, TwinEvent, TwinSnapshot } from '../shared/types';
import { createDashboardModel, mergeTwinEvents } from './viewModel';
import './styles.css';

interface ApiUpdate {
  snapshot: TwinSnapshot;
  events: TwinEvent[];
}

function App(): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<TwinSnapshot | null>(null);
  const [events, setEvents] = React.useState<TwinEvent[]>([]);

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

  async function startScenario(id: string): Promise<void> {
    const update = await postUpdate(`/api/scenarios/${id}/start`, {});
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
  const rooms = Object.values(snapshot.rooms);
  const devices = Object.values(snapshot.devices);

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
          <h2>Scenarios</h2>
          <button onClick={() => startScenario('weekday_normal')}><Play size={16} /> Weekday</button>
          <button onClick={() => startScenario('away_day')}><Home size={16} /> Away</button>
          <button onClick={() => startScenario('night_water_leak')}><AlertTriangle size={16} /> Leak</button>
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
          <div className="floorplan-shell">
            <div className="roof-line" aria-hidden="true" />
            <div className="floorplan" aria-label="Virtual home floorplan">
              {rooms.map((room) => (
                <article key={room.id} className={`room room-${room.id} ${room.occupancy ? 'occupied' : ''} ${room.lightsOn ? 'lit' : ''}`}>
                  <div className="presence-layer" aria-label={`${room.name} people and devices`}>
                    {model.floorplanRooms[room.id].people.map((person) => (
                      <span
                        key={person.id}
                        className={`person-marker person-slot-${person.slot} ${person.recent ? 'recent' : ''}`}
                        title={`${person.label}: ${person.activity}`}
                      >
                        {getPersonInitials(person.id)}
                      </span>
                    ))}
                    {model.floorplanRooms[room.id].devices.filter((device) => device.active).slice(0, getDeviceMarkerLimit(room.id)).map((device) => (
                      <span
                        key={device.id}
                        className={`device-marker device-slot-${device.slot} ${device.active ? 'active' : 'idle'}`}
                        title={`${device.id}: ${device.active ? 'active' : 'idle'}`}
                      >
                        {device.label}
                      </span>
                    ))}
                    {getDeviceMarkerLimit(room.id) > 0 && model.floorplanRooms[room.id].activeDeviceCount > getDeviceMarkerLimit(room.id) ? (
                      <span className="device-more">+{model.floorplanRooms[room.id].activeDeviceCount - getDeviceMarkerLimit(room.id)}</span>
                    ) : null}
                  </div>
                  <div className="room-header">
                    <strong>{getRoomLabel(room.id)}</strong>
                    <span>{room.temperatureC.toFixed(1)}C / {room.humidityPercent.toFixed(0)}%</span>
                  </div>
                  <div className="room-fixtures" aria-hidden="true">
                    {getRoomDecor(room.id).map((item) => (
                      <span key={item} className={`fixture ${item}`} />
                    ))}
                  </div>
                  {model.floorplanRooms[room.id].people.length || model.floorplanRooms[room.id].activeDeviceCount ? (
                    <em className="room-active-count">
                      {model.floorplanRooms[room.id].people.length}p / {model.floorplanRooms[room.id].activeDeviceCount}d
                    </em>
                  ) : null}
                </article>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Device State</h2>
            <div className="device-list">
              {devices.slice(0, 12).map((device) => (
                <div key={device.id} className="device-row">
                  <span>{device.id}</span>
                  <code>{summarizeState(device.state)}</code>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Alerts</h2>
            {model.alerts.length === 0 ? <p className="muted">No active alerts.</p> : model.alerts.map((alert) => (
              <div key={alert.id} className="alert-row">
                <strong>{alert.message}</strong>
                <span>{alert.severity} / {alert.recommendedAction}</span>
              </div>
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

function getRoomDecor(roomId: RoomId): string[] {
  const decor: Record<RoomId, string[]> = {
    entrance: ['door', 'shoe-bench'],
    living_room: ['sofa', 'coffee-table', 'tv-wall'],
    kitchen: ['counter', 'stove', 'fridge'],
    dining_room: ['dining-table', 'chair-a', 'chair-b'],
    master_bedroom: ['bed-large', 'wardrobe'],
    child_bedroom: ['bed-small', 'desk-small'],
    study: ['desk', 'bookcase'],
    bathroom: ['tub', 'sink'],
    garden: ['patio', 'plant-a', 'plant-b', 'sprinkler']
  };
  return decor[roomId];
}

function getRoomLabel(roomId: RoomId): string {
  const labels: Record<RoomId, string> = {
    entrance: 'Entry',
    living_room: 'Living Room',
    kitchen: 'Kitchen',
    dining_room: 'Dining',
    master_bedroom: 'Master',
    child_bedroom: 'Child Room',
    study: 'Study',
    bathroom: 'Bath',
    garden: 'Garden'
  };
  return labels[roomId];
}

function getDeviceMarkerLimit(roomId: RoomId): number {
  if (['entrance', 'child_bedroom', 'study', 'bathroom'].includes(roomId)) {
    return 0;
  }
  return roomId === 'garden' ? 1 : 2;
}

function getPersonInitials(personId: string): string {
  const initials: Record<string, string> = {
    adult_1: 'A1',
    adult_2: 'A2',
    child_1: 'C',
    senior_1: 'S',
    pet_1: 'P'
  };
  return initials[personId] ?? personId.slice(0, 2).toUpperCase();
}

async function postUpdate(url: string, payload: unknown): Promise<ApiUpdate> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json() as Promise<ApiUpdate>;
}

function summarizeState(state: Record<string, string | number | boolean | null>): string {
  return Object.entries(state).slice(0, 3).map(([key, value]) => `${key}:${String(value)}`).join(' ');
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

createRoot(document.getElementById('root')!).render(<App />);
