import React from 'react';
import { Pause, Play, Radio, RotateCcw } from 'lucide-react';
import {
  buildDeviceEventSocketUrl,
  cursorFromDeviceRunChanged,
  cursorFromProcessedDeviceUpdate,
  nextDeviceEventReconnectDelayMs,
  parseDeviceEventSocketMessage,
  type DeviceEventCursor,
  type DeviceValueEvent
} from './deviceEventSocket';
import { HomeMemory3D } from './HomeMemory3D';
import { createHomeMemory, reduceDeviceEvents, type HomeMemory, type MemoryEvidence } from './homeMemoryModel';
import {
  createDeviceEvidenceGraphHighlight,
  createFocusedNodeGraphHighlight,
  createHomeMemoryGraphModel,
  type HomeMemoryGraphHighlight,
  type HomeMemoryGraphNode
} from './homeMemoryGraphModel';
import {
  createEventEvidenceFlow,
  createHypothesisReasoning,
  type EventEvidenceFlow,
  type HypothesisReasoning
} from './homeMemoryReasoning';
import { createHomeProfileHypotheses, type ProfileHypothesis } from './homeProfiler';

type MemorySocketStatus = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'offline';

const RECENT_DEVICE_EVENT_LIMIT = 40;

export function HomeMemoryView(): React.ReactElement {
  const [memory, setMemory] = React.useState<HomeMemory>(() => createHomeMemory());
  const [recentEvents, setRecentEvents] = React.useState<DeviceValueEvent[]>([]);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [paused, setPaused] = React.useState(false);
  const [connectionStatus, setConnectionStatus] = React.useState<Exclude<MemorySocketStatus, 'paused'>>('connecting');
  const [lastHeartbeatAt, setLastHeartbeatAt] = React.useState<string | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = React.useState<string | null>(null);
  const [memoryWarning, setMemoryWarning] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState<DeviceEventCursor | null>(null);
  const [activeEvidenceEvent, setActiveEvidenceEvent] = React.useState<DeviceValueEvent | null>(null);
  const cursorRef = React.useRef<DeviceEventCursor | null>(null);

  React.useEffect(() => {
    if (paused) {
      return;
    }

    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let shortReconnect = false;
    let staleSocket = false;
    let socketGeneration = 0;
    let socket: WebSocket | undefined;

    function updateCursor(nextCursor: DeviceEventCursor): void {
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
    }

    function resetMemory(): void {
      setMemory(createHomeMemory());
      setRecentEvents([]);
      setSelectedNodeId(null);
      setMemoryWarning(null);
      setActiveEvidenceEvent(null);
    }

    function connect(): void {
      if (disposed) return;
      staleSocket = false;
      const generation = ++socketGeneration;
      setConnectionStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
      socket = new WebSocket(buildDeviceEventSocketUrl(window.location, cursorRef.current));
      socket.addEventListener('open', () => {
        if (disposed || staleSocket || generation !== socketGeneration) return;
        reconnectAttempt = 0;
        setConnectionStatus('live');
      });
      socket.addEventListener('message', (message) => {
        if (disposed || staleSocket || generation !== socketGeneration) return;
        let update;
        try {
          update = parseDeviceEventSocketMessage(String(message.data));
        } catch {
          setConnectionStatus('offline');
          return;
        }

        if (update.type === 'device.heartbeat') {
          setLastHeartbeatAt(update.ts);
          setConnectionStatus('live');
          return;
        }

        if (update.type === 'device.run_changed') {
          updateCursor(cursorFromDeviceRunChanged(update));
          resetMemory();
          staleSocket = true;
          shortReconnect = true;
          setConnectionStatus('reconnecting');
          socket?.close();
          return;
        }

        updateCursor(cursorFromProcessedDeviceUpdate(update));
        setLastUpdateAt(new Date().toISOString());
        setConnectionStatus('live');

        if (update.replayComplete === false) {
          if (update.events.length > 0) {
            setMemory((current) => reduceDeviceEvents(current, update.events));
            setRecentEvents((current) => [
              ...newestFirst(update.events),
              ...current
            ].slice(0, RECENT_DEVICE_EVENT_LIMIT));
            setActiveEvidenceEvent(latestBySequence(update.events));
          }
          setSelectedNodeId(null);
          setMemoryWarning('Replay was incomplete; memory is showing the processed partial batch until the device stream catches up.');
          staleSocket = true;
          shortReconnect = true;
          setConnectionStatus('reconnecting');
          socket?.close();
          return;
        }

        setMemoryWarning(null);
        if (update.events.length > 0) {
          setMemory((current) => reduceDeviceEvents(current, update.events));
          setRecentEvents((current) => [
            ...newestFirst(update.events),
            ...current
          ].slice(0, RECENT_DEVICE_EVENT_LIMIT));
          setActiveEvidenceEvent(latestBySequence(update.events));
        }
      });
      socket.addEventListener('close', () => {
        if (disposed || generation !== socketGeneration) return;
        setConnectionStatus('reconnecting');
        reconnectTimer = setTimeout(connect, shortReconnect ? 250 : nextDeviceEventReconnectDelayMs(reconnectAttempt));
        if (shortReconnect) {
          reconnectAttempt = 0;
          shortReconnect = false;
          return;
        }
        reconnectAttempt += 1;
      });
      socket.addEventListener('error', () => {
        if (!disposed && !staleSocket && generation === socketGeneration) {
          setConnectionStatus('offline');
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
  }, [paused]);

  const hypotheses = React.useMemo(() => createHomeProfileHypotheses(memory), [memory]);
  const graph = React.useMemo(() => createHomeMemoryGraphModel(memory, hypotheses), [hypotheses, memory]);
  const evidenceHighlight = React.useMemo(
    () => (activeEvidenceEvent ? createDeviceEvidenceGraphHighlight(graph, activeEvidenceEvent) : EMPTY_GRAPH_HIGHLIGHT),
    [activeEvidenceEvent, graph]
  );
  const focusedHighlight = React.useMemo(
    () => createFocusedNodeGraphHighlight(graph, selectedNodeId),
    [graph, selectedNodeId]
  );
  const graphHighlight = React.useMemo(
    () => mergeGraphHighlights(evidenceHighlight, focusedHighlight),
    [evidenceHighlight, focusedHighlight]
  );
  const selectedNode = React.useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId]
  );
  const selectedHypothesis = React.useMemo(
    () => hypothesisForNode(hypotheses, selectedNode) ?? hypotheses.find((hypothesis) => hypothesis.type === 'household_size') ?? hypotheses[0] ?? null,
    [hypotheses, selectedNode]
  );
  const eventFlow = React.useMemo(
    () => createEventEvidenceFlow(memory, hypotheses, memory.recentEvents[0] ?? null),
    [hypotheses, memory]
  );
  const hypothesisReasoning = React.useMemo(
    () => (selectedHypothesis ? createHypothesisReasoning(memory, selectedHypothesis) : null),
    [memory, selectedHypothesis]
  );
  const status: MemorySocketStatus = paused ? 'paused' : connectionStatus;

  React.useEffect(() => {
    if (selectedNodeId && !graph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [graph.nodes, selectedNodeId]);

  React.useEffect(() => {
    if (!activeEvidenceEvent) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setActiveEvidenceEvent(null);
    }, 4600);

    return () => window.clearTimeout(timer);
  }, [activeEvidenceEvent]);

  function clearMemory(): void {
    setMemory(createHomeMemory());
    setRecentEvents([]);
    setSelectedNodeId(null);
    setMemoryWarning(null);
    setActiveEvidenceEvent(null);
  }

  return (
    <div className="memory-view">
      <div className="memory-toolbar">
        <div>
          <span className="eyebrow">Home memory</span>
          <h1>Device-observed memory graph</h1>
          <p>Built only from the device event socket stream.</p>
        </div>
        <div className="memory-toolbar-actions">
          <span className={`status-pill memory-status ${status}`}>
            <i />
            {memoryStatusLabel(status)}
          </span>
          <button onClick={() => setPaused((current) => !current)} aria-pressed={paused}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={clearMemory}>
            <RotateCcw size={15} />
            Reset
          </button>
        </div>
      </div>
      {memoryWarning ? <div className="memory-warning" role="status">{memoryWarning}</div> : null}

      <div className="memory-main">
        <section className="memory-graph-canvas-shell" aria-label="Home memory 3D graph">
          <HomeMemory3D
            graph={graph}
            highlightedEdgeIds={graphHighlight.edgeIds}
            highlightedNodeIds={graphHighlight.nodeIds}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
          <div className="memory-layer-legend" aria-label="Home memory graph layers">
            <span><i className="home" /> Home</span>
            <span><i className="room" /> Rooms</span>
            <span><i className="device" /> Devices</span>
            <span><i className="field" /> Fields</span>
            <span><i className="hypothesis" /> Hypotheses</span>
          </div>
          <div className="memory-cursor-strip" aria-label="Device event cursor">
            <span><Radio size={14} /> {cursor ? `Run ${cursor.runId}` : 'Waiting for device stream'}</span>
            <span>{cursor ? `Sequence ${cursor.sequence}` : 'No cursor yet'}</span>
            <span>{lastHeartbeatAt ? `Heartbeat ${formatTime(lastHeartbeatAt)}` : 'No heartbeat'}</span>
          </div>
        </section>

        <aside className="memory-sidebar">
          <ProfileStatsPanel
            memory={memory}
            hypotheses={hypotheses}
            nodeCount={graph.nodes.length}
            edgeCount={graph.edges.length}
            lastUpdateAt={lastUpdateAt}
            onSelectHypothesis={(nodeId) => setSelectedNodeId(nodeId)}
          />
          <ReasoningFlowPanel
            eventFlow={eventFlow}
            hypothesisReasoning={hypothesisReasoning}
            selectedHypothesis={selectedHypothesis}
            onSelectHypothesis={(nodeId) => setSelectedNodeId(nodeId)}
          />
          <SelectedMemoryPanel
            memory={memory}
            hypotheses={hypotheses}
            selectedNode={selectedNode}
          />
        </aside>
      </div>

      <RecentDeviceEventStrip events={recentEvents} />
    </div>
  );
}

const EMPTY_GRAPH_HIGHLIGHT: HomeMemoryGraphHighlight = {
  nodeIds: [],
  edgeIds: []
};

function mergeGraphHighlights(...highlights: HomeMemoryGraphHighlight[]): HomeMemoryGraphHighlight {
  return {
    nodeIds: sortedUnique(highlights.flatMap((highlight) => highlight.nodeIds)),
    edgeIds: sortedUnique(highlights.flatMap((highlight) => highlight.edgeIds))
  };
}

function latestBySequence(events: DeviceValueEvent[]): DeviceValueEvent {
  return [...events].sort((left, right) => right.sequence - left.sequence)[0];
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hypothesisForNode(hypotheses: ProfileHypothesis[], node: HomeMemoryGraphNode | null): ProfileHypothesis | null {
  if (!node || node.kind !== 'hypothesis') {
    return null;
  }
  return hypotheses.find((hypothesis) => `hypothesis:${hypothesis.id}` === node.id) ?? null;
}

function ProfileStatsPanel({
  memory,
  hypotheses,
  nodeCount,
  edgeCount,
  lastUpdateAt,
  onSelectHypothesis
}: {
  memory: HomeMemory;
  hypotheses: ProfileHypothesis[];
  nodeCount: number;
  edgeCount: number;
  lastUpdateAt: string | null;
  onSelectHypothesis: (nodeId: string) => void;
}): React.ReactElement {
  return (
    <section className="memory-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Profile stats</span>
          <h2>Observed shape</h2>
        </div>
      </div>
      <div className="memory-stats">
        <Stat label="Events" value={memory.totalEvents} />
        <Stat label="Rooms" value={Object.keys(memory.rooms).length} />
        <Stat label="Devices" value={Object.keys(memory.devices).length} />
        <Stat label="Fields" value={Object.keys(memory.fields).length} />
        <Stat label="Episodes" value={memory.episodeCount} />
        <Stat label="Hypotheses" value={hypotheses.length} />
        <Stat label="Graph" value={`${nodeCount}/${edgeCount}`} />
      </div>
      <div className="memory-tree compact">
        <MemoryTreeRow label="Home" value={memory.homeId ?? 'Unknown'} />
        <MemoryTreeRow label="Run" value={memory.runId ?? 'No observed run'} />
        <MemoryTreeRow label="Latest update" value={lastUpdateAt ? formatTime(lastUpdateAt) : 'Waiting'} />
      </div>
      <div className="memory-hypothesis-list">
        {hypotheses.slice(0, 4).map((hypothesis) => (
          <button key={hypothesis.id} onClick={() => onSelectHypothesis(`hypothesis:${hypothesis.id}`)} title={hypothesis.summary}>
            <strong>{hypothesis.label}</strong>
            <span>{Math.round(hypothesis.confidence * 100)}% confidence</span>
          </button>
        ))}
        {hypotheses.length === 0 ? <p className="muted">No profile hypotheses yet.</p> : null}
      </div>
    </section>
  );
}

function ReasoningFlowPanel({
  eventFlow,
  hypothesisReasoning,
  selectedHypothesis,
  onSelectHypothesis
}: {
  eventFlow: EventEvidenceFlow | null;
  hypothesisReasoning: HypothesisReasoning | null;
  selectedHypothesis: ProfileHypothesis | null;
  onSelectHypothesis: (nodeId: string) => void;
}): React.ReactElement {
  return (
    <section className="memory-panel reasoning-flow-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Reasoning flow</span>
          <h2>Event to profile</h2>
        </div>
      </div>
      {eventFlow ? (
        <div className="reasoning-flow-block">
          <strong>{eventFlow.title}</strong>
          <ReasoningSteps steps={eventFlow.steps} />
          {eventFlow.relatedHypotheses.length > 0 ? (
            <div className="reasoning-chip-row">
              {eventFlow.relatedHypotheses.slice(0, 4).map((hypothesis) => (
                <button
                  key={hypothesis.id}
                  onClick={() => onSelectHypothesis(`hypothesis:${hypothesis.id}`)}
                  title={hypothesis.summary}
                >
                  {hypothesis.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted">Waiting for a device event to explain the flow.</p>
      )}

      {hypothesisReasoning && selectedHypothesis ? (
        <div className="reasoning-flow-block">
          <div className="reasoning-result">
            <span>{selectedHypothesis.type.replaceAll('_', ' ')}</span>
            <strong>{hypothesisReasoning.result}</strong>
          </div>
          <div className="reasoning-inputs">
            {hypothesisReasoning.inputs.map((input) => (
              <div key={input.label}>
                <span>{input.label}</span>
                <strong>{input.value}</strong>
              </div>
            ))}
          </div>
          <div className="reasoning-rule">
            <span>Rule matched</span>
            <p>{hypothesisReasoning.rule}</p>
          </div>
          <ReasoningSteps steps={hypothesisReasoning.steps} />
        </div>
      ) : null}
    </section>
  );
}

function ReasoningSteps({ steps }: { steps: Array<{ label: string; detail: string; metrics?: Array<{ label: string; value: string }> }> }): React.ReactElement {
  return (
    <ol className="reasoning-steps">
      {steps.map((step) => (
        <li key={step.label}>
          <strong>{step.label}</strong>
          <p>{step.detail}</p>
          {step.metrics ? (
            <div className="reasoning-metrics">
              {step.metrics.map((metric) => (
                <span key={metric.label}>{metric.label}: {metric.value}</span>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function SelectedMemoryPanel({
  memory,
  hypotheses,
  selectedNode
}: {
  memory: HomeMemory;
  hypotheses: ProfileHypothesis[];
  selectedNode: HomeMemoryGraphNode | null;
}): React.ReactElement {
  const details = selectedNode ? selectedDetails(memory, hypotheses, selectedNode) : null;

  return (
    <section className="memory-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Selected memory</span>
          <h2>{selectedNode?.label ?? 'No node selected'}</h2>
        </div>
      </div>
      {selectedNode && details ? (
        <>
          <p className="memory-node-summary">{selectedNode.summary}</p>
          <div className="memory-tree">
            <MemoryTreeRow label="Kind" value={selectedNode.kind} />
            <MemoryTreeRow label="Activity" value={String(selectedNode.activity)} />
            {selectedNode.confidence !== undefined ? (
              <MemoryTreeRow label="Confidence" value={`${Math.round(selectedNode.confidence * 100)}%`} />
            ) : null}
            {details.rows.map((row) => <MemoryTreeRow key={row.label} label={row.label} value={row.value} />)}
          </div>
          <EvidenceList evidence={details.evidence} />
        </>
      ) : (
        <p className="muted">Select a sphere to inspect memory and evidence.</p>
      )}
    </section>
  );
}

function RecentDeviceEventStrip({ events }: { events: DeviceValueEvent[] }): React.ReactElement {
  return (
    <section className="memory-panel memory-event-strip" aria-label="Recent device events">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Recent device events</span>
          <h2>Newest first</h2>
        </div>
      </div>
      <div>
        {events.map((event) => (
          <div key={event.id} className="memory-event-row">
            <time>{formatTime(event.simTime)}</time>
            <strong>{event.deviceId}</strong>
            <span>{event.field}</span>
            <code>{formatValue(event.value)}</code>
            <small>{event.sourceEventType}</small>
          </div>
        ))}
        {events.length === 0 ? <p className="muted">No device events observed yet.</p> : null}
      </div>
    </section>
  );
}

function EvidenceList({ evidence }: { evidence: MemoryEvidence[] }): React.ReactElement {
  return (
    <div className="memory-evidence-list">
      <strong>Evidence</strong>
      {evidence.slice(0, 6).map((item) => (
        <div key={item.id} className="memory-event-row">
          <time>{formatTime(item.simTime)}</time>
          <strong>{item.deviceId}</strong>
          <span>{item.field}</span>
          <code>{formatValue(item.value)}</code>
        </div>
      ))}
      {evidence.length === 0 ? <p className="muted">No direct evidence attached.</p> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }): React.ReactElement {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MemoryTreeRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function selectedDetails(
  memory: HomeMemory,
  hypotheses: ProfileHypothesis[],
  node: HomeMemoryGraphNode
): { rows: Array<{ label: string; value: string }>; evidence: MemoryEvidence[] } {
  if (node.kind === 'room') {
    const room = memory.rooms[node.id.slice('room:'.length)];
    return {
      rows: room
        ? [
            { label: 'Devices', value: String(room.devices.length) },
            { label: 'Fields', value: String(room.activeFields.length) },
            { label: 'Episodes', value: episodesForRoom(memory, room.roomId).length.toString() },
            { label: 'Last seen', value: formatTime(room.lastSeenAt) }
          ]
        : [],
      evidence: room?.recentEvents ?? []
    };
  }
  if (node.kind === 'device') {
    const device = memory.devices[node.id.slice('device:'.length)];
    return {
      rows: device
        ? [
            { label: 'Room', value: device.roomId },
            { label: 'Type', value: device.type },
            { label: 'Fields', value: device.fields.length.toString() },
            { label: 'Episodes', value: episodesForDevice(memory, device.deviceId).length.toString() }
          ]
        : [],
      evidence: device?.recentEvents ?? []
    };
  }
  if (node.kind === 'field') {
    const field = memory.fields[node.id.slice('field:'.length)];
    return {
      rows: field
        ? [
            { label: 'Device', value: field.deviceId },
            { label: 'Field', value: field.field },
            { label: 'Current', value: formatValue(field.currentValue) },
            { label: 'Episodes', value: episodesForField(memory, field.id).length.toString() }
          ]
        : [],
      evidence: field?.recentEvents ?? []
    };
  }
  if (node.kind === 'hypothesis') {
    const hypothesis = hypotheses.find((candidate) => `hypothesis:${candidate.id}` === node.id);
    return {
      rows: hypothesis
        ? [
            { label: 'Type', value: hypothesis.type.replaceAll('_', ' ') },
            { label: 'Updated', value: formatTime(hypothesis.updatedAt) },
            { label: 'Subjects', value: hypothesis.subjectIds.length.toString() }
          ]
        : [],
      evidence: hypothesis?.evidence ?? []
    };
  }
  return {
    rows: [
      { label: 'Rooms', value: Object.keys(memory.rooms).length.toString() },
      { label: 'Devices', value: Object.keys(memory.devices).length.toString() },
      { label: 'Episodes', value: memory.episodeCount.toString() }
    ],
    evidence: memory.recentEvents
  };
}

function episodesForRoom(memory: HomeMemory, roomId: string): HomeMemory['episodes'][string][] {
  return Object.values(memory.episodes).filter((episode) => episode.roomId === roomId);
}

function episodesForDevice(memory: HomeMemory, deviceId: string): HomeMemory['episodes'][string][] {
  return Object.values(memory.episodes).filter((episode) => episode.deviceId === deviceId);
}

function episodesForField(memory: HomeMemory, fieldId: string): HomeMemory['episodes'][string][] {
  return Object.values(memory.episodes).filter((episode) => episode.fieldId === fieldId);
}

function newestFirst(events: DeviceValueEvent[]): DeviceValueEvent[] {
  return [...events].sort((left, right) => right.sequence - left.sequence);
}

function memoryStatusLabel(status: MemorySocketStatus): string {
  if (status === 'live') return 'Memory live';
  if (status === 'paused') return 'Memory paused';
  if (status === 'reconnecting') return 'Memory reconnecting';
  if (status === 'offline') return 'Memory offline';
  return 'Memory connecting';
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatValue(value: DeviceValueEvent['value']): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
