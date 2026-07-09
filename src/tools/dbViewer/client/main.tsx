import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Database,
  FileSearch,
  Home,
  RefreshCw,
  Search,
  TableProperties
} from 'lucide-react';
import type {
  DbViewerAgentProfileEntryDetail,
  DbViewerAgentProfileEntrySummary,
  DbViewerDeviceEvent,
  DbViewerDeviceEventQueryAudit,
  DbViewerHealth,
  DbViewerHomeMemoryItem,
  DbViewerRun,
  DbViewerSourceResolution
} from '../types';
import {
  createAgentProfileRows,
  createDeviceEventRows,
  createHomeMemoryRows,
  describeSourceResolution,
  formatJson,
  type HomeMemorySection
} from './viewModel';
import './styles.css';

type Page = 'agent' | 'home-memory' | 'device-events';

function App(): React.ReactElement {
  const [page, setPage] = React.useState<Page>('agent');
  const [health, setHealth] = React.useState<DbViewerHealth | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [agentEntries, setAgentEntries] = React.useState<DbViewerAgentProfileEntrySummary[]>([]);
  const [selectedEntry, setSelectedEntry] = React.useState<DbViewerAgentProfileEntryDetail | null>(null);
  const [sourceResolution, setSourceResolution] = React.useState<DbViewerSourceResolution | null>(null);
  const [agentFilters, setAgentFilters] = React.useState({
    homeId: '',
    text: '',
    status: '',
    entryType: '',
    subjectType: ''
  });
  const [runs, setRuns] = React.useState<DbViewerRun[]>([]);
  const [selectedRun, setSelectedRun] = React.useState<DbViewerRun | null>(null);
  const [homeMemoryHomeId, setHomeMemoryHomeId] = React.useState('');
  const [memorySection, setMemorySection] = React.useState<HomeMemorySection>('evidence');
  const [memoryText, setMemoryText] = React.useState('');
  const [memoryItems, setMemoryItems] = React.useState<DbViewerHomeMemoryItem[]>([]);
  const [selectedMemoryItem, setSelectedMemoryItem] = React.useState<DbViewerHomeMemoryItem | null>(null);
  const [deviceFilters, setDeviceFilters] = React.useState({
    homeId: '',
    runId: '',
    roomId: '',
    deviceId: '',
    field: '',
    q: ''
  });
  const [deviceEvents, setDeviceEvents] = React.useState<DbViewerDeviceEvent[]>([]);
  const [selectedDeviceEvent, setSelectedDeviceEvent] = React.useState<DbViewerDeviceEvent | null>(null);
  const [nearbyDeviceEvents, setNearbyDeviceEvents] = React.useState<DbViewerDeviceEvent[]>([]);
  const [deviceQueries, setDeviceQueries] = React.useState<DbViewerDeviceEventQueryAudit[]>([]);
  const [selectedDeviceQuery, setSelectedDeviceQuery] = React.useState<DbViewerDeviceEventQueryAudit | null>(null);

  React.useEffect(() => {
    void refreshAll();
  }, []);

  React.useEffect(() => {
    if (selectedRun) {
      void loadMemoryItems(selectedRun, memorySection, memoryText);
    }
  }, [selectedRun, memorySection]);

  async function refreshAll(): Promise<void> {
    setError(null);
    try {
      const [nextHealth, nextEntries, nextRuns] = await Promise.all([
        getJson<DbViewerHealth>('/api/db-viewer/health'),
        getJson<{ items: DbViewerAgentProfileEntrySummary[] }>('/api/db-viewer/agent-profile/entries'),
        getJson<{ items: DbViewerRun[] }>('/api/db-viewer/home-memory/runs')
      ]);
      setHealth(nextHealth);
      setAgentEntries(nextEntries.items);
      setRuns(nextRuns.items);
      const firstRun = nextRuns.items[0] ?? null;
      setSelectedRun((current) => current ?? firstRun);
      if (firstRun) {
        await loadMemoryItems(firstRun, memorySection, memoryText);
      }
      if (nextHealth.deviceEventsAvailable) {
        await Promise.all([loadDeviceEvents(), loadDeviceQueries()]);
      }
    } catch (refreshError) {
      setError(formatError(refreshError));
    }
  }

  async function loadAgentEntries(): Promise<void> {
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(agentFilters)) {
        if (value.trim()) {
          params.set(key, value.trim());
        }
      }
      const response = await getJson<{ items: DbViewerAgentProfileEntrySummary[] }>(`/api/db-viewer/agent-profile/entries?${params.toString()}`);
      setAgentEntries(response.items);
      setSelectedEntry(null);
      setSourceResolution(null);
    } catch (loadError) {
      setError(formatError(loadError));
    }
  }

  async function selectEntry(entryId: string): Promise<void> {
    setError(null);
    setSourceResolution(null);
    try {
      setSelectedEntry(await getJson<DbViewerAgentProfileEntryDetail>(`/api/db-viewer/agent-profile/entries/${encodeURIComponent(entryId)}`));
    } catch (loadError) {
      setError(formatError(loadError));
    }
  }

  async function resolveSource(source: DbViewerAgentProfileEntryDetail['sources'][number]): Promise<void> {
    if (!source.sourceType.startsWith('home_memory_') && source.sourceType !== 'device_event_query') {
      return;
    }
    setError(null);
    try {
      const params = new URLSearchParams({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        homeId: source.homeId
      });
      if (source.runId) {
        params.set('runId', source.runId);
      }
      setSourceResolution(await getJson<DbViewerSourceResolution>(`/api/db-viewer/home-memory/source?${params.toString()}`));
    } catch (loadError) {
      setError(formatError(loadError));
    }
  }

  async function loadDeviceEvents(): Promise<void> {
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(deviceFilters)) {
        if (value.trim()) {
          params.set(key, value.trim());
        }
      }
      const response = await getJson<{ items: DbViewerDeviceEvent[] }>(`/api/db-viewer/device-events?${params.toString()}`);
      setDeviceEvents(response.items);
      setSelectedDeviceEvent(response.items[0] ?? null);
      setNearbyDeviceEvents([]);
    } catch (loadError) {
      setError(formatError(loadError));
    }
  }

  async function loadDeviceQueries(): Promise<void> {
    setError(null);
    try {
      const response = await getJson<{ items: DbViewerDeviceEventQueryAudit[] }>('/api/db-viewer/device-event-queries');
      setDeviceQueries(response.items);
      setSelectedDeviceQuery(response.items[0] ?? null);
    } catch (loadError) {
      setError(formatError(loadError));
    }
  }

  async function loadNearbyDeviceEvents(sourceEventId: string): Promise<void> {
    setError(null);
    try {
      const params = new URLSearchParams({ sourceEventId, windowMinutes: '30' });
      const response = await getJson<{ source: DbViewerDeviceEvent | null; items: DbViewerDeviceEvent[] }>(`/api/db-viewer/device-events/around-source?${params.toString()}`);
      setNearbyDeviceEvents(response.items);
      if (response.source) {
        setSelectedDeviceEvent(response.source);
      }
      setPage('device-events');
    } catch (loadError) {
      setError(formatError(loadError));
    }
  }

  async function loadMemoryItems(run: DbViewerRun, section: HomeMemorySection, text: string): Promise<void> {
    setError(null);
    try {
      const params = new URLSearchParams({ homeId: run.homeId, runId: run.runId });
      if (text.trim()) {
        params.set('text', text.trim());
      }
      const endpoint = section === 'evidence'
        ? '/api/db-viewer/home-memory/evidence'
        : section === 'hypotheses'
          ? '/api/db-viewer/home-memory/hypotheses'
          : '/api/db-viewer/home-memory/portrait-sections';
      const response = await getJson<{ items: DbViewerHomeMemoryItem[] }>(`${endpoint}?${params.toString()}`);
      setMemoryItems(response.items);
      setSelectedMemoryItem(response.items[0] ?? null);
    } catch (loadError) {
      setError(formatError(loadError));
    }
  }

  async function loadRuns(homeId: string): Promise<void> {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (homeId.trim()) {
        params.set('homeId', homeId.trim());
      }
      const response = await getJson<{ items: DbViewerRun[] }>(`/api/db-viewer/home-memory/runs?${params.toString()}`);
      setRuns(response.items);
      const nextRun = response.items[0] ?? null;
      setSelectedRun(nextRun);
      if (nextRun) {
        await loadMemoryItems(nextRun, memorySection, memoryText);
      } else {
        setMemoryItems([]);
        setSelectedMemoryItem(null);
      }
    } catch (loadError) {
      setError(formatError(loadError));
    }
  }

  const agentRows = createAgentProfileRows(agentEntries);
  const memoryRows = createHomeMemoryRows(memorySection, memoryItems);
  const deviceRows = createDeviceEventRows(deviceEvents);

  return (
    <main className="viewer-shell">
      <aside className="viewer-sidebar">
        <div className="viewer-brand">
          <Database size={24} />
          <div>
            <strong>DB Viewer</strong>
            <span>VirtualHome local stores</span>
          </div>
        </div>
        <nav aria-label="Viewer sections">
          <button className={page === 'agent' ? 'active' : ''} onClick={() => setPage('agent')}>
            <FileSearch size={16} /> Agent Profile
          </button>
          <button className={page === 'home-memory' ? 'active' : ''} onClick={() => setPage('home-memory')}>
            <Home size={16} /> Home Memory Store
          </button>
          <button className={page === 'device-events' ? 'active' : ''} onClick={() => setPage('device-events')} disabled={!health?.deviceEventsAvailable}>
            <Activity size={16} /> Device Events
          </button>
        </nav>
      </aside>

      <section className="viewer-workspace">
        <header className="viewer-topbar">
          <div>
            <h1>{page === 'agent' ? 'Agent Profile' : page === 'home-memory' ? 'Home Memory Store' : 'Device Events'}</h1>
            <p>{health ? `${health.homeMemoryDatabasePath} | ${health.agentProfileDatabasePath}${health.deviceEventsDatabasePath ? ` | ${health.deviceEventsDatabasePath}` : ''}` : 'Checking database health...'}</p>
          </div>
          <div className="viewer-status-row">
            <span className={`viewer-status ${health?.status ?? 'unhealthy'}`}>{health?.status ?? 'loading'}</span>
            <button onClick={() => void refreshAll()} title="Refresh database viewer">
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </header>

        {error ? <div className="viewer-error">{error}</div> : null}

        {page === 'agent' ? (
          <AgentProfilePage
            filters={agentFilters}
            setFilters={setAgentFilters}
            rows={agentRows}
            entries={agentEntries}
            selectedEntry={selectedEntry}
            sourceResolution={sourceResolution}
            onSearch={() => void loadAgentEntries()}
            onSelectEntry={(entryId) => void selectEntry(entryId)}
            onResolveSource={(source) => void resolveSource(source)}
          />
        ) : page === 'home-memory' ? (
          <HomeMemoryPage
            runs={runs}
            selectedRun={selectedRun}
            homeId={homeMemoryHomeId}
            section={memorySection}
            text={memoryText}
            rows={memoryRows}
            items={memoryItems}
            selectedItem={selectedMemoryItem}
            onHomeIdChange={setHomeMemoryHomeId}
            onLoadRuns={() => void loadRuns(homeMemoryHomeId)}
            onSelectRun={(run) => setSelectedRun(run)}
            onSectionChange={setMemorySection}
            onTextChange={setMemoryText}
            onSearch={() => selectedRun ? void loadMemoryItems(selectedRun, memorySection, memoryText) : undefined}
            onSelectItem={setSelectedMemoryItem}
            onOpenSourceEvent={(sourceEventId) => void loadNearbyDeviceEvents(sourceEventId)}
          />
        ) : (
          <DeviceEventsPage
            enabled={Boolean(health?.deviceEventsAvailable)}
            filters={deviceFilters}
            setFilters={setDeviceFilters}
            rows={deviceRows}
            events={deviceEvents}
            selectedEvent={selectedDeviceEvent}
            nearbyEvents={nearbyDeviceEvents}
            queries={deviceQueries}
            selectedQuery={selectedDeviceQuery}
            onSearch={() => void loadDeviceEvents()}
            onRefreshQueries={() => void loadDeviceQueries()}
            onSelectEvent={setSelectedDeviceEvent}
            onAroundSource={(sourceEventId) => void loadNearbyDeviceEvents(sourceEventId)}
            onSelectQuery={setSelectedDeviceQuery}
          />
        )}
      </section>
    </main>
  );
}

function AgentProfilePage({
  filters,
  setFilters,
  rows,
  entries,
  selectedEntry,
  sourceResolution,
  onSearch,
  onSelectEntry,
  onResolveSource
}: {
  filters: { homeId: string; text: string; status: string; entryType: string; subjectType: string };
  setFilters: React.Dispatch<React.SetStateAction<{ homeId: string; text: string; status: string; entryType: string; subjectType: string }>>;
  rows: ReturnType<typeof createAgentProfileRows>;
  entries: DbViewerAgentProfileEntrySummary[];
  selectedEntry: DbViewerAgentProfileEntryDetail | null;
  sourceResolution: DbViewerSourceResolution | null;
  onSearch: () => void;
  onSelectEntry: (entryId: string) => void;
  onResolveSource: (source: DbViewerAgentProfileEntryDetail['sources'][number]) => void;
}): React.ReactElement {
  return (
    <div className="viewer-page-grid">
      <section className="viewer-list">
        <div className="viewer-filters">
          <input value={filters.homeId} placeholder="home id" onChange={(event) => setFilters((current) => ({ ...current, homeId: event.target.value }))} />
          <input value={filters.text} placeholder="search text" onChange={(event) => setFilters((current) => ({ ...current, text: event.target.value }))} />
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">Any status</option>
            <option value="candidate">candidate</option>
            <option value="active">active</option>
            <option value="rejected">rejected</option>
            <option value="superseded">superseded</option>
            <option value="archived">archived</option>
          </select>
          <input value={filters.entryType} placeholder="entry type" onChange={(event) => setFilters((current) => ({ ...current, entryType: event.target.value }))} />
          <input value={filters.subjectType} placeholder="subject type" onChange={(event) => setFilters((current) => ({ ...current, subjectType: event.target.value }))} />
          <button onClick={onSearch}><Search size={16} /> Search</button>
        </div>
        <div className="viewer-table agent-table">
          <div className="viewer-table-head">
            <span>Title</span>
            <span>Subject</span>
            <span>Type</span>
            <span>Status</span>
            <span>Conf.</span>
            <span>Updated</span>
          </div>
          {rows.map((row) => (
            <button key={row.id} className="viewer-table-row" onClick={() => onSelectEntry(row.id)}>
              <span>{row.title}</span>
              <span>{row.subject}</span>
              <span>{row.entryType}</span>
              <span>{row.status}</span>
              <span>{row.confidence}</span>
              <span>{row.updatedAt}</span>
            </button>
          ))}
          {entries.length === 0 ? <p className="viewer-empty">No Agent Profile entries found.</p> : null}
        </div>
      </section>

      <aside className="viewer-detail">
        {selectedEntry ? (
          <>
            <h2>{selectedEntry.title}</h2>
            <p>{selectedEntry.summary}</p>
            <DetailBlock title="Content" value={selectedEntry.content} />
            <DetailBlock title="Structured Claim" value={selectedEntry.claimIndex} />
            <DetailBlock title="Time Windows" value={selectedEntry.timeWindows} />
            <section className="viewer-detail-section">
              <h3>Sources</h3>
              {selectedEntry.sources.map((source) => (
                <button key={source.id} className="source-row" onClick={() => onResolveSource(source)}>
                  <strong>{source.sourceType}</strong>
                  <span>{source.sourceId}</span>
                  <small>{source.homeId}/{source.runId ?? 'no run'} weight {source.weight.toFixed(2)}</small>
                </button>
              ))}
              {sourceResolution ? (
                <div className={`source-resolution ${sourceResolution.status}`}>
                  <strong>{describeSourceResolution(sourceResolution)}</strong>
                  <pre>{formatJson(sourceResolution)}</pre>
                </div>
              ) : null}
            </section>
            <DetailBlock title="Audit Events" value={selectedEntry.events} />
          </>
        ) : (
          <div className="viewer-empty-detail">
            <TableProperties size={28} />
            <span>Select an Agent Profile entry.</span>
          </div>
        )}
      </aside>
    </div>
  );
}

function HomeMemoryPage({
  runs,
  selectedRun,
  homeId,
  section,
  text,
  rows,
  items,
  selectedItem,
  onHomeIdChange,
  onLoadRuns,
  onSelectRun,
  onSectionChange,
  onTextChange,
  onSearch,
  onSelectItem,
  onOpenSourceEvent
}: {
  runs: DbViewerRun[];
  selectedRun: DbViewerRun | null;
  homeId: string;
  section: HomeMemorySection;
  text: string;
  rows: ReturnType<typeof createHomeMemoryRows>;
  items: DbViewerHomeMemoryItem[];
  selectedItem: DbViewerHomeMemoryItem | null;
  onHomeIdChange: (homeId: string) => void;
  onLoadRuns: () => void;
  onSelectRun: (run: DbViewerRun) => void;
  onSectionChange: (section: HomeMemorySection) => void;
  onTextChange: (text: string) => void;
  onSearch: () => void;
  onSelectItem: (item: DbViewerHomeMemoryItem) => void;
  onOpenSourceEvent: (sourceEventId: string) => void;
}): React.ReactElement {
  return (
    <div className="viewer-page-grid">
      <section className="viewer-list">
        <div className="viewer-filters memory-filters">
          <input value={homeId} placeholder="home id" onChange={(event) => onHomeIdChange(event.target.value)} />
          <button onClick={onLoadRuns}><RefreshCw size={16} /> Runs</button>
          <select value={selectedRun?.runId ?? ''} onChange={(event) => {
            const run = runs.find((item) => item.runId === event.target.value);
            if (run) onSelectRun(run);
          }}>
            {runs.map((run) => <option key={`${run.homeId}:${run.runId}`} value={run.runId}>{run.homeId} / {run.runId}</option>)}
          </select>
          <select value={section} onChange={(event) => onSectionChange(event.target.value as HomeMemorySection)}>
            <option value="evidence">Evidence</option>
            <option value="hypotheses">Hypotheses</option>
            <option value="portrait">Portrait Sections</option>
          </select>
          <input value={text} placeholder="filter current section" onChange={(event) => onTextChange(event.target.value)} />
          <button onClick={onSearch}><Search size={16} /> Search</button>
        </div>
        <div className="viewer-table memory-table">
          <div className="viewer-table-head">
            <span>Primary</span>
            <span>Summary</span>
            <span>Metric</span>
            <span>Count</span>
          </div>
          {rows.map((row) => {
            const item = items.find((candidate) => candidate.id === row.id);
            return (
              <button key={row.id} className="viewer-table-row" onClick={() => item ? onSelectItem(item) : undefined}>
                <span>{row.primary}</span>
                <span>{row.secondary}</span>
                <span>{row.metric}</span>
                <span>{row.count}</span>
              </button>
            );
          })}
          {items.length === 0 ? <p className="viewer-empty">No Home Memory rows found.</p> : null}
        </div>
      </section>
      <aside className="viewer-detail">
        {selectedItem ? (
          <>
            <h2>{selectedItem.id}</h2>
            {typeof selectedItem.sourceEventId === 'string' ? (
              <button onClick={() => onOpenSourceEvent(String(selectedItem.sourceEventId))}>
                <Activity size={16} /> Source Event Window
              </button>
            ) : null}
            <DetailBlock title="Normalized Row" value={selectedItem} />
            <DetailBlock title="Payload JSON" value={selectedItem.payload} />
          </>
        ) : (
          <div className="viewer-empty-detail">
            <TableProperties size={28} />
            <span>Select a Home Memory row.</span>
          </div>
        )}
      </aside>
    </div>
  );
}

function DeviceEventsPage({
  enabled,
  filters,
  setFilters,
  rows,
  events,
  selectedEvent,
  nearbyEvents,
  queries,
  selectedQuery,
  onSearch,
  onRefreshQueries,
  onSelectEvent,
  onAroundSource,
  onSelectQuery
}: {
  enabled: boolean;
  filters: { homeId: string; runId: string; roomId: string; deviceId: string; field: string; q: string };
  setFilters: React.Dispatch<React.SetStateAction<{ homeId: string; runId: string; roomId: string; deviceId: string; field: string; q: string }>>;
  rows: ReturnType<typeof createDeviceEventRows>;
  events: DbViewerDeviceEvent[];
  selectedEvent: DbViewerDeviceEvent | null;
  nearbyEvents: DbViewerDeviceEvent[];
  queries: DbViewerDeviceEventQueryAudit[];
  selectedQuery: DbViewerDeviceEventQueryAudit | null;
  onSearch: () => void;
  onRefreshQueries: () => void;
  onSelectEvent: (event: DbViewerDeviceEvent) => void;
  onAroundSource: (sourceEventId: string) => void;
  onSelectQuery: (query: DbViewerDeviceEventQueryAudit) => void;
}): React.ReactElement {
  if (!enabled) {
    return (
      <div className="viewer-empty-detail">
        <Activity size={28} />
        <span>Device Events DB is not configured for this viewer.</span>
      </div>
    );
  }
  return (
    <div className="viewer-page-grid">
      <section className="viewer-list">
        <div className="viewer-filters device-filters">
          <input value={filters.homeId} placeholder="home id" onChange={(event) => setFilters((current) => ({ ...current, homeId: event.target.value }))} />
          <input value={filters.runId} placeholder="run id" onChange={(event) => setFilters((current) => ({ ...current, runId: event.target.value }))} />
          <input value={filters.roomId} placeholder="room" onChange={(event) => setFilters((current) => ({ ...current, roomId: event.target.value }))} />
          <input value={filters.deviceId} placeholder="device" onChange={(event) => setFilters((current) => ({ ...current, deviceId: event.target.value }))} />
          <input value={filters.field} placeholder="field" onChange={(event) => setFilters((current) => ({ ...current, field: event.target.value }))} />
          <input value={filters.q} placeholder="full-text" onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} />
          <button onClick={onSearch}><Search size={16} /> Search</button>
        </div>
        <div className="viewer-table device-table">
          <div className="viewer-table-head">
            <span>Time</span>
            <span>Room</span>
            <span>Device</span>
            <span>Field</span>
            <span>Value</span>
            <span>Source</span>
          </div>
          {rows.map((row) => {
            const item = events.find((candidate) => candidate.id === row.id);
            return (
              <button key={row.id} className="viewer-table-row" onClick={() => item ? onSelectEvent(item) : undefined}>
                <span>{row.simTime}</span>
                <span>{row.room}</span>
                <span>{row.device}</span>
                <span>{row.field}</span>
                <span>{row.value}</span>
                <span>{row.sourceEventId}</span>
              </button>
            );
          })}
          {events.length === 0 ? <p className="viewer-empty">No Device Events found.</p> : null}
        </div>
      </section>
      <aside className="viewer-detail">
        {selectedEvent ? (
          <>
            <h2>{selectedEvent.id}</h2>
            <button onClick={() => onAroundSource(selectedEvent.sourceEventId)}>
              <Activity size={16} /> Nearby Events
            </button>
            <DetailBlock title="Event" value={selectedEvent} />
            <DetailBlock title="Payload JSON" value={selectedEvent.payload} />
            {nearbyEvents.length > 0 ? <DetailBlock title="Nearby Events" value={nearbyEvents} /> : null}
          </>
        ) : (
          <div className="viewer-empty-detail">
            <TableProperties size={28} />
            <span>Select a Device Event.</span>
          </div>
        )}
        <section className="viewer-detail-section">
          <div className="detail-heading-row">
            <h3>Query Audit</h3>
            <button onClick={onRefreshQueries}><RefreshCw size={16} /> Queries</button>
          </div>
          {queries.map((query) => (
            <button key={query.id} className="source-row" onClick={() => onSelectQuery(query)}>
              <strong>{query.id}</strong>
              <span>{query.summary ?? 'No summary'}</span>
              <small>{query.homeId}/{query.runId ?? 'no run'} results {query.resultCount}</small>
            </button>
          ))}
          {selectedQuery ? <pre>{formatJson(selectedQuery)}</pre> : null}
        </section>
      </aside>
    </div>
  );
}

function DetailBlock({ title, value }: { title: string; value: unknown }): React.ReactElement {
  return (
    <section className="viewer-detail-section">
      <h3>{title}</h3>
      <pre>{formatJson(value)}</pre>
    </section>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(formatJson(body));
  }
  return body as T;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById('root')!).render(<App />);
