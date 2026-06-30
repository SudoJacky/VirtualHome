import React from 'react';
import { Map, Network, Pause, Play, Radio, RotateCcw } from 'lucide-react';
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
import { createHomeMemory, reduceDeviceEvents, type HomeMemory, type MemoryEvidence, type SemanticSignal } from './homeMemoryModel';
import {
  createDeviceEvidenceGraphHighlight,
  createFocusedNodeGraphHighlight,
  createHomeMemoryGraphModel,
  type HomeMemoryGraphHighlight,
  type HomeMemoryGraphLayoutMode,
  type HomeMemoryGraphNode
} from './homeMemoryGraphModel';
import {
  createEventEvidenceFlow,
  createHypothesisReasoning,
  createHypothesisWhiteBoxTrace,
  type EventEvidenceFlow,
  type HypothesisReasoning,
  type HypothesisWhiteBoxTrace
} from './homeMemoryReasoning';
import {
  createEvidenceExplanationSummary,
  createSemanticSignalRows,
  type SemanticSignalRow
} from './homeMemoryViewModel';
import { isMemoryLocale, memoryCopy, type MemoryCopy, type MemoryLocale } from './homeMemoryI18n';
import { createHomeProfileHypotheses, type ProfileHypothesis } from './homeProfiler';

type MemorySocketStatus = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'offline';

const RECENT_DEVICE_EVENT_LIMIT = 40;
const MEMORY_LOCALE_STORAGE_KEY = 'virtualhome.memory.locale';

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
  const [memoryGraphMode, setMemoryGraphMode] = React.useState<HomeMemoryGraphLayoutMode>('spatial');
  const [locale, setLocale] = React.useState<MemoryLocale>(() => initialMemoryLocale());
  const cursorRef = React.useRef<DeviceEventCursor | null>(null);
  const copy = React.useMemo(() => memoryCopy(locale), [locale]);

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
  const graph = React.useMemo(() => createHomeMemoryGraphModel(memory, hypotheses, { layoutMode: memoryGraphMode }), [hypotheses, memory, memoryGraphMode]);
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
  const hypothesisWhiteBoxTrace = React.useMemo(
    () => (selectedHypothesis ? createHypothesisWhiteBoxTrace(memory, selectedHypothesis) : null),
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

  React.useEffect(() => {
    window.localStorage.setItem(MEMORY_LOCALE_STORAGE_KEY, locale);
  }, [locale]);

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
          <span className="eyebrow">{copy.toolbar.eyebrow}</span>
          <h1>{copy.toolbar.title}</h1>
          <p>{copy.toolbar.subtitle}</p>
        </div>
        <div className="memory-toolbar-actions">
          <span className={`status-pill memory-status ${status}`}>
            <i />
            {copy.status[status]}
          </span>
          <button onClick={() => setPaused((current) => !current)} aria-pressed={paused}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
            {paused ? copy.toolbar.resume : copy.toolbar.pause}
          </button>
          <button onClick={clearMemory}>
            <RotateCcw size={15} />
            {copy.toolbar.reset}
          </button>
          <div className="memory-language-toggle" aria-label={copy.language.label}>
            <button
              className={locale === 'en' ? 'active' : ''}
              onClick={() => setLocale('en')}
              aria-pressed={locale === 'en'}
            >
              {copy.language.english}
            </button>
            <button
              className={locale === 'zh' ? 'active' : ''}
              onClick={() => setLocale('zh')}
              aria-pressed={locale === 'zh'}
            >
              {copy.language.chinese}
            </button>
          </div>
          <div className="memory-view-mode-toggle" aria-label={copy.graph.viewModeLabel}>
            <button
              className={memoryGraphMode === 'spatial' ? 'active' : ''}
              onClick={() => setMemoryGraphMode('spatial')}
              aria-pressed={memoryGraphMode === 'spatial'}
              title={copy.graph.spatialTitle}
            >
              <Map size={15} />
              {copy.graph.spatial}
            </button>
            <button
              className={memoryGraphMode === 'topology' ? 'active' : ''}
              onClick={() => setMemoryGraphMode('topology')}
              aria-pressed={memoryGraphMode === 'topology'}
              title={copy.graph.topologyTitle}
            >
              <Network size={15} />
              {copy.graph.topology}
            </button>
          </div>
        </div>
      </div>
      {memoryWarning ? <div className="memory-warning" role="status">{memoryWarning}</div> : null}

      <div className="memory-main">
        <section className="memory-graph-canvas-shell" aria-label={copy.graph.canvasLabel}>
          <HomeMemory3D
            graph={graph}
            highlightedEdgeIds={graphHighlight.edgeIds}
            highlightedNodeIds={graphHighlight.nodeIds}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
          <div className="memory-layer-legend" aria-label={copy.graph.layerLabel}>
            <span><i className="home" /> {copy.graph.layers.home}</span>
            <span><i className="room" /> {copy.graph.layers.rooms}</span>
            <span><i className="device" /> {copy.graph.layers.devices}</span>
            <span><i className="field" /> {copy.graph.layers.fields}</span>
            <span><i className="semantic" /> {copy.graph.layers.semantic}</span>
            <span><i className="hypothesis" /> {copy.graph.layers.hypotheses}</span>
          </div>
          <div className="memory-cursor-strip" aria-label={copy.graph.cursorLabel}>
            <span><Radio size={14} /> {cursor ? `Run ${cursor.runId}` : copy.graph.waitingStream}</span>
            <span>{cursor ? `${copy.graph.sequence} ${cursor.sequence}` : copy.graph.noCursor}</span>
            <span>{lastHeartbeatAt ? `${copy.graph.heartbeat} ${formatTime(lastHeartbeatAt)}` : copy.graph.noHeartbeat}</span>
          </div>
        </section>

        <aside className="memory-sidebar">
          <ProfileStatsPanel
            memory={memory}
            hypotheses={hypotheses}
            nodeCount={graph.nodes.length}
            edgeCount={graph.edges.length}
            lastUpdateAt={lastUpdateAt}
            copy={copy}
            onSelectHypothesis={(nodeId) => setSelectedNodeId(nodeId)}
          />
          <SemanticSignalsPanel signals={createSemanticSignalRows(memory, 6)} copy={copy} />
          <ReasoningFlowPanel
            eventFlow={eventFlow}
            hypothesisReasoning={hypothesisReasoning}
            selectedHypothesis={selectedHypothesis}
            copy={copy}
            onSelectHypothesis={(nodeId) => setSelectedNodeId(nodeId)}
          />
          <SelectedMemoryPanel
            memory={memory}
            hypotheses={hypotheses}
            selectedNode={selectedNode}
            copy={copy}
          />
        </aside>
      </div>

      {hypothesisWhiteBoxTrace ? <WhiteBoxTracePanel trace={hypothesisWhiteBoxTrace} copy={copy} /> : null}

      <RecentDeviceEventStrip events={recentEvents} copy={copy} />
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

function initialMemoryLocale(): MemoryLocale {
  if (typeof window === 'undefined') {
    return 'en';
  }
  const stored = window.localStorage.getItem(MEMORY_LOCALE_STORAGE_KEY);
  return isMemoryLocale(stored) ? stored : 'en';
}

function ProfileStatsPanel({
  memory,
  hypotheses,
  nodeCount,
  edgeCount,
  lastUpdateAt,
  copy,
  onSelectHypothesis
}: {
  memory: HomeMemory;
  hypotheses: ProfileHypothesis[];
  nodeCount: number;
  edgeCount: number;
  lastUpdateAt: string | null;
  copy: MemoryCopy;
  onSelectHypothesis: (nodeId: string) => void;
}): React.ReactElement {
  return (
    <section className="memory-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.profileStats.eyebrow}</span>
          <h2>{copy.profileStats.title}</h2>
        </div>
      </div>
      <div className="memory-stats">
        <Stat label={copy.profileStats.stats.events} value={memory.totalEvents} />
        <Stat label={copy.profileStats.stats.rooms} value={Object.keys(memory.rooms).length} />
        <Stat label={copy.profileStats.stats.devices} value={Object.keys(memory.devices).length} />
        <Stat label={copy.profileStats.stats.fields} value={Object.keys(memory.fields).length} />
        <Stat label={copy.profileStats.stats.episodes} value={memory.episodeCount} />
        <Stat label={copy.profileStats.stats.semanticSignals} value={memory.semanticSignalCount} />
        <Stat label={copy.profileStats.stats.days} value={memory.dailySummaryCount} />
        <Stat label={copy.profileStats.stats.weeks} value={memory.weeklySummaryCount} />
        <Stat label={copy.profileStats.stats.hypotheses} value={hypotheses.length} />
        <Stat label={copy.profileStats.stats.graph} value={`${nodeCount}/${edgeCount}`} />
      </div>
      <div className="memory-tree compact">
        <MemoryTreeRow label={copy.profileStats.home} value={memory.homeId ?? copy.profileStats.unknown} />
        <MemoryTreeRow label={copy.profileStats.run} value={memory.runId ?? copy.profileStats.noObservedRun} />
        <MemoryTreeRow label={copy.profileStats.latestUpdate} value={lastUpdateAt ? formatTime(lastUpdateAt) : copy.profileStats.waiting} />
      </div>
      <div className="memory-hypothesis-list">
        {hypotheses.slice(0, 4).map((hypothesis) => (
          <button key={hypothesis.id} onClick={() => onSelectHypothesis(`hypothesis:${hypothesis.id}`)} title={hypothesis.summary}>
            <strong>{hypothesis.label}</strong>
            <span>{Math.round(hypothesis.confidence * 100)}% {copy.profileStats.confidence}</span>
          </button>
        ))}
        {hypotheses.length === 0 ? <p className="muted">{copy.profileStats.emptyHypotheses}</p> : null}
      </div>
    </section>
  );
}

function SemanticSignalsPanel({ signals, copy }: { signals: SemanticSignalRow[]; copy: MemoryCopy }): React.ReactElement {
  return (
    <section className="memory-panel semantic-signal-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.semanticSignals.eyebrow}</span>
          <h2>{copy.semanticSignals.title}</h2>
        </div>
      </div>
      <div className="semantic-signal-list">
        {signals.map((signal) => (
          <div key={signal.id} className="semantic-signal-row" title={signal.reason}>
            <time>{formatTime(signal.time)}</time>
            <strong>{signal.typeLabel}</strong>
            <span>{signal.location}</span>
            <span>{signal.source}</span>
            <code>{signal.value}</code>
            <small>{signal.strength} / {signal.weight}</small>
          </div>
        ))}
        {signals.length === 0 ? <p className="muted">{copy.semanticSignals.empty}</p> : null}
      </div>
    </section>
  );
}

function ReasoningFlowPanel({
  eventFlow,
  hypothesisReasoning,
  selectedHypothesis,
  copy,
  onSelectHypothesis
}: {
  eventFlow: EventEvidenceFlow | null;
  hypothesisReasoning: HypothesisReasoning | null;
  selectedHypothesis: ProfileHypothesis | null;
  copy: MemoryCopy;
  onSelectHypothesis: (nodeId: string) => void;
}): React.ReactElement {
  return (
    <section className="memory-panel reasoning-flow-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.reasoning.eyebrow}</span>
          <h2>{copy.reasoning.title}</h2>
        </div>
      </div>
      {eventFlow ? (
        <div className="reasoning-flow-block">
          <strong>{eventFlow.title}</strong>
          <ReasoningSteps steps={eventFlow.steps} copy={copy} />
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
        <p className="muted">{copy.reasoning.waiting}</p>
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
                <span>{translateRowLabel(input.label, copy)}</span>
                <strong>{input.value}</strong>
              </div>
            ))}
          </div>
          <div className="reasoning-rule">
            <span>{copy.reasoning.ruleMatched}</span>
            <p>{hypothesisReasoning.rule}</p>
          </div>
          <ReasoningSteps steps={hypothesisReasoning.steps} copy={copy} />
        </div>
      ) : null}
    </section>
  );
}

function ReasoningSteps({ steps, copy }: { steps: Array<{ label: string; detail: string; metrics?: Array<{ label: string; value: string }> }>; copy: MemoryCopy }): React.ReactElement {
  return (
    <ol className="reasoning-steps">
      {steps.map((step) => (
        <li key={step.label}>
          <strong>{translateRowLabel(step.label, copy)}</strong>
          <p>{step.detail}</p>
          {step.metrics ? (
            <div className="reasoning-metrics">
              {step.metrics.map((metric) => (
                <span key={metric.label}>{translateRowLabel(metric.label, copy)}: {metric.value}</span>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function WhiteBoxTracePanel({ trace, copy }: { trace: HypothesisWhiteBoxTrace; copy: MemoryCopy }): React.ReactElement {
  return (
    <section className="memory-panel whitebox-trace-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.whiteBox.eyebrow}</span>
          <h2>{whiteBoxTitle(trace.title, copy)}</h2>
        </div>
      </div>
      <div className="whitebox-conclusion-banner">
        <div>
          <span>{trace.conclusion.type.replaceAll('_', ' ')}</span>
          <strong>{trace.conclusion.label}</strong>
          <p>{trace.conclusion.summary}</p>
        </div>
        <b title={copy.whiteBox.confidence}>{trace.conclusion.confidence}</b>
      </div>
      <div className="whitebox-flow-diagram" aria-label={copy.whiteBox.ariaLabel}>
        {trace.sections.map((section, index) => (
          <section key={section.title} className={`whitebox-flow-card ${whiteBoxStageClass(section.title)}`}>
            <header>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{whiteBoxSectionTitle(section.title, copy)}</strong>
              <p>{whiteBoxSectionDescription(section, copy)}</p>
            </header>
            <div className="whitebox-card-body">
              {section.rows.map((row) => (
                <div key={`${section.title}:${row.label}:${row.value}`} className="whitebox-row">
                  <span>{translateRowLabel(row.label, copy)}</span>
                  <strong>{row.value}</strong>
                  {row.note ? <small>{row.note}</small> : null}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="whitebox-ledger">
        <div>
          <strong>{copy.whiteBox.ledgerTitle}</strong>
          <p>{copy.whiteBox.ledgerSubtitle}</p>
        </div>
        {trace.sections.map((section) => (
          <section key={`ledger:${section.title}`} className="whitebox-ledger-section">
            <header>
              <strong>{whiteBoxSectionTitle(section.title, copy)}</strong>
              <span>{section.rows.length}</span>
            </header>
            <div className="whitebox-ledger-rows">
              {section.rows.map((row, index) => (
                <div key={`ledger:${section.title}:${row.label}:${row.value}:${index}`} className="whitebox-ledger-row">
                  <span>{translateRowLabel(row.label, copy)}</span>
                  <strong>{row.value}</strong>
                  {row.note ? <small>{row.note}</small> : null}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function whiteBoxTitle(title: string, copy: MemoryCopy): string {
  if (title === 'Why this conclusion was inferred' && copy.whiteBox.eyebrow !== 'White-box reasoning') {
    return '为什么得到这个结论';
  }
  return title;
}

function whiteBoxSectionTitle(title: string, copy: MemoryCopy): string {
  return copy.whiteBoxStages[title]?.title ?? title;
}

function whiteBoxSectionDescription(section: HypothesisWhiteBoxTrace['sections'][number], copy: MemoryCopy): string {
  return copy.whiteBoxStages[section.title]?.description ?? section.description;
}

function translateRowLabel(label: string, copy: MemoryCopy): string {
  return copy.rowLabels[label] ?? label;
}

function whiteBoxStageClass(title: string): string {
  if (title.includes('Evidence')) return 'stage-evidence';
  if (title.includes('Semantic')) return 'stage-semantic';
  if (title.includes('Aggregate') || title.includes('Rule')) return 'stage-features';
  if (title.includes('Scoring')) return 'stage-scoring';
  if (title.includes('Confidence')) return 'stage-confidence';
  if (title.includes('Missing')) return 'stage-gaps';
  return 'stage-observed';
}

function SelectedMemoryPanel({
  memory,
  hypotheses,
  selectedNode,
  copy
}: {
  memory: HomeMemory;
  hypotheses: ProfileHypothesis[];
  selectedNode: HomeMemoryGraphNode | null;
  copy: MemoryCopy;
}): React.ReactElement {
  const details = selectedNode ? selectedDetails(memory, hypotheses, selectedNode) : null;

  return (
    <section className="memory-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.selectedMemory.eyebrow}</span>
          <h2>{selectedNode?.label ?? copy.selectedMemory.emptyTitle}</h2>
        </div>
      </div>
      {selectedNode && details ? (
        <>
          <p className="memory-node-summary">{selectedNode.summary}</p>
          <div className="memory-tree">
            <MemoryTreeRow label={translateRowLabel('Kind', copy)} value={selectedNode.kind} />
            <MemoryTreeRow label={translateRowLabel('Activity', copy)} value={String(selectedNode.activity)} />
            {selectedNode.confidence !== undefined ? (
              <MemoryTreeRow label={translateRowLabel('Confidence', copy)} value={`${Math.round(selectedNode.confidence * 100)}%`} />
            ) : null}
            {details.rows.map((row) => <MemoryTreeRow key={row.label} label={translateRowLabel(row.label, copy)} value={row.value} />)}
          </div>
          {details.explanation ? <EvidenceBreakdown summary={details.explanation} copy={copy} /> : null}
          <EvidenceList evidence={details.evidence} copy={copy} />
        </>
      ) : (
        <p className="muted">{copy.selectedMemory.empty}</p>
      )}
    </section>
  );
}

function EvidenceBreakdown({ summary, copy }: { summary: ReturnType<typeof createEvidenceExplanationSummary>; copy: MemoryCopy }): React.ReactElement {
  return (
    <div className="memory-evidence-breakdown">
      <div>
        <span>{copy.evidenceBreakdown.supporting}</span>
        <strong>{summary.supportingCount}</strong>
      </div>
      <div>
        <span>{copy.evidenceBreakdown.contradicting}</span>
        <strong>{summary.contradictingCount}</strong>
      </div>
      <div>
        <span>{copy.evidenceBreakdown.missing}</span>
        <strong>{summary.missingCount}</strong>
      </div>
      {summary.missingItems.length > 0 ? (
        <ul>
          {summary.missingItems.slice(0, 2).map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function RecentDeviceEventStrip({ events, copy }: { events: DeviceValueEvent[]; copy: MemoryCopy }): React.ReactElement {
  return (
    <section className="memory-panel memory-event-strip" aria-label={copy.recentEvents.ariaLabel}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.recentEvents.eyebrow}</span>
          <h2>{copy.recentEvents.title}</h2>
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
        {events.length === 0 ? <p className="muted">{copy.recentEvents.empty}</p> : null}
      </div>
    </section>
  );
}

function EvidenceList({ evidence, copy }: { evidence: MemoryEvidence[]; copy: MemoryCopy }): React.ReactElement {
  return (
    <div className="memory-evidence-list">
      <strong>{copy.evidence.title}</strong>
      {evidence.slice(0, 6).map((item) => (
        <div key={item.id} className="memory-event-row">
          <time>{formatTime(item.simTime)}</time>
          <strong>{item.deviceId}</strong>
          <span>{item.field}</span>
          <code>{formatValue(item.value)}</code>
        </div>
      ))}
      {evidence.length === 0 ? <p className="muted">{copy.evidence.empty}</p> : null}
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
): { rows: Array<{ label: string; value: string }>; evidence: MemoryEvidence[]; explanation?: ReturnType<typeof createEvidenceExplanationSummary> } {
  if (node.kind === 'room') {
    const room = memory.rooms[node.id.slice('room:'.length)];
    return {
      rows: room
        ? [
            { label: 'Devices', value: String(room.devices.length) },
            { label: 'Fields', value: String(room.activeFields.length) },
            { label: 'Episodes', value: episodesForRoom(memory, room.roomId).length.toString() },
            { label: 'Active days', value: dailySummariesForRoom(memory, room.roomId).length.toString() },
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
  if (node.kind === 'semantic') {
    const signals = semanticSignalsForNode(memory, node.id);
    const latestSignal = signals[0];
    const evidence = evidenceForSemanticSignals(memory, signals);

    return {
      rows: latestSignal
        ? [
            { label: 'Type', value: latestSignal.type.replaceAll('_', ' ') },
            { label: 'Room', value: latestSignal.roomId },
            { label: 'Device', value: latestSignal.deviceId },
            { label: 'Field', value: latestSignal.field },
            { label: 'Signals', value: signals.length.toString() },
            { label: 'Weight', value: sumSignalWeight(signals).toString() },
            { label: 'Latest', value: formatTime(latestSignal.simTime) }
          ]
        : [],
      evidence
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
      evidence: hypothesis?.evidence ?? [],
      explanation: hypothesis ? createEvidenceExplanationSummary(hypothesis) : undefined
    };
  }
  return {
    rows: [
      { label: 'Rooms', value: Object.keys(memory.rooms).length.toString() },
      { label: 'Devices', value: Object.keys(memory.devices).length.toString() },
      { label: 'Episodes', value: memory.episodeCount.toString() },
      { label: 'Observed days', value: memory.dailySummaryCount.toString() },
      { label: 'Observed weeks', value: memory.weeklySummaryCount.toString() },
      { label: 'Long-window rooms', value: longWindowRooms(memory).length.toString() }
    ],
    evidence: memory.recentEvents
  };
}

function semanticSignalsForNode(memory: HomeMemory, nodeId: string): SemanticSignal[] {
  return memory.semanticSignals
    .filter((signal) => semanticSignalNodeId(signal) === nodeId)
    .sort((left, right) => right.simTime.localeCompare(left.simTime));
}

function semanticSignalNodeId(signal: SemanticSignal): string {
  return `semantic:${signal.type}:${signal.roomId}:${signal.deviceId}:${signal.field}`;
}

function evidenceForSemanticSignals(memory: HomeMemory, signals: SemanticSignal[]): MemoryEvidence[] {
  const evidenceIds = new Set(signals.flatMap((signal) => signal.sourceEvidenceIds));
  return Object.values(memory.fields)
    .flatMap((field) => field.recentEvents)
    .filter((event) => evidenceIds.has(event.id))
    .sort((left, right) => right.simTime.localeCompare(left.simTime));
}

function sumSignalWeight(signals: SemanticSignal[]): number {
  return Number(signals.reduce((total, signal) => total + signal.profileWeight, 0).toFixed(3));
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

function dailySummariesForRoom(memory: HomeMemory, roomId: string): HomeMemory['dailySummaries'][string][] {
  return Object.values(memory.dailySummaries).filter((summary) => summary.activeRooms.includes(roomId));
}

function longWindowRooms(memory: HomeMemory): string[] {
  return [...new Set([
    ...Object.values(memory.dailySummaries).flatMap((summary) => summary.meaningfulRooms),
    ...Object.values(memory.weeklySummaries).flatMap((summary) => summary.meaningfulRooms)
  ])].sort((left, right) => left.localeCompare(right));
}

function newestFirst(events: DeviceValueEvent[]): DeviceValueEvent[] {
  return [...events].sort((left, right) => right.sequence - left.sequence);
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatValue(value: DeviceValueEvent['value']): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
