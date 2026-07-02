import React from 'react';
import { Map, Network, Pause, Play, Radio, RotateCcw } from 'lucide-react';
import { getJson, putJson } from './apiClient';
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
import { createEventStateLedger, type EventStateLedger } from './homeMemoryEventStateLedger';
import {
  createEvidenceExplanationSummary,
  createHomeMemoryLlmTrace,
  createMemoryDemoWalkthrough,
  createSemanticSignalRows,
  type HomeMemoryLlmTrace,
  type HomeMemoryLlmTraceBatchInput,
  type HomeMemoryLlmTraceEnrichment,
  type HomeMemoryLlmSource,
  type MemoryDemoWalkthrough,
  type SemanticSignalRow
} from './homeMemoryViewModel';
import { isMemoryLocale, memoryCopy, type MemoryCopy, type MemoryLocale } from './homeMemoryI18n';
import { createHomeProfileHypotheses, type ProfileHypothesis } from './homeProfiler';

type MemorySocketStatus = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'offline';

const RECENT_DEVICE_EVENT_LIMIT = 40;
const MEMORY_LOCALE_STORAGE_KEY = 'virtualhome.memory.locale';

interface HomeMemoryLlmApiHypothesis {
  id: string;
  label: string;
  llmEnrichmentSource?: HomeMemoryLlmSource;
  llmEnrichment?: HomeMemoryLlmTraceEnrichment;
  llmEnrichmentErrors?: string[];
  llmReliabilityReviewSource?: HomeMemoryLlmSource;
  llmReliabilityReview?: HomeMemoryLlmTraceEnrichment;
  llmReliabilityReviewErrors?: string[];
}

interface HomeMemoryLlmApiHypothesisResponse {
  items: HomeMemoryLlmApiHypothesis[];
}

interface HomeMemoryLlmApiPortrait {
  llmSummarySource?: HomeMemoryLlmSource;
  llmSummary?: HomeMemoryLlmTraceEnrichment;
  llmSummaryErrors?: string[];
}

interface HomeMemoryLlmApiBatchPlan {
  items: HomeMemoryLlmTraceBatchInput[];
}

interface HomeMemoryLlmApiMetrics {
  enabled: boolean;
  cacheSize: number;
  rates: {
    cacheHitRate: number;
    fallbackRate: number;
    validationRejectionRate: number;
    userTriggeredCallRatio: number;
  };
  budgets: {
    callsThisHour: number;
    maxCallsPerHomePerHour: number;
    callsToday: number;
    maxCallsPerHomePerDay: number;
  };
}

interface HomeMemoryLlmApiConfig {
  provider: {
    enabled: boolean;
    provider: 'openai-compatible';
    baseUrl: string;
    model: string;
    timeoutMs: number;
    maxRetries: number;
    apiKeyConfigured: boolean;
  };
  budget: {
    maxCallsPerHomePerHour: number;
    maxCallsPerHomePerDay: number;
    maxBatchSize: number;
  };
  gates: {
    minEvidenceCountForUnknownSchema: number;
    minConfidenceForReview: number;
    maxConfidenceForReview: number;
  };
}

interface HomeMemoryLlmStreamLogEntry {
  event: string;
  data: Record<string, unknown>;
}

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
  const [selectedLedgerEventId, setSelectedLedgerEventId] = React.useState<string | null>(null);
  const [memoryGraphMode, setMemoryGraphMode] = React.useState<HomeMemoryGraphLayoutMode>('spatial');
  const [locale, setLocale] = React.useState<MemoryLocale>(() => initialMemoryLocale());
  const [llmHypotheses, setLlmHypotheses] = React.useState<HomeMemoryLlmApiHypothesis[]>([]);
  const [llmPortrait, setLlmPortrait] = React.useState<HomeMemoryLlmApiPortrait | null>(null);
  const [llmBatchPlan, setLlmBatchPlan] = React.useState<HomeMemoryLlmApiBatchPlan | null>(null);
  const [llmMetrics, setLlmMetrics] = React.useState<HomeMemoryLlmApiMetrics | null>(null);
  const [llmConfig, setLlmConfig] = React.useState<HomeMemoryLlmApiConfig | null>(null);
  const [llmConfigDraft, setLlmConfigDraft] = React.useState<HomeMemoryLlmApiConfig | null>(null);
  const [llmApiKeyDraft, setLlmApiKeyDraft] = React.useState('');
  const [llmConfigSaving, setLlmConfigSaving] = React.useState(false);
  const [llmStreamLoading, setLlmStreamLoading] = React.useState(false);
  const [llmStreamLog, setLlmStreamLog] = React.useState<HomeMemoryLlmStreamLogEntry[]>([]);
  const [llmStreamOutput, setLlmStreamOutput] = React.useState('');
  const [llmTraceError, setLlmTraceError] = React.useState<string | null>(null);
  const [llmTraceLoading, setLlmTraceLoading] = React.useState(false);
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
      setSelectedLedgerEventId(null);
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
  const selectedLedgerEvent = React.useMemo(
    () => recentEvents.find((event) => event.id === selectedLedgerEventId) ?? recentEvents[0] ?? null,
    [recentEvents, selectedLedgerEventId]
  );
  const eventStateLedger = React.useMemo(
    () => (selectedLedgerEvent ? createEventStateLedger(recentEvents, selectedLedgerEvent.id) : null),
    [recentEvents, selectedLedgerEvent?.id]
  );
  const hypothesisReasoning = React.useMemo(
    () => (selectedHypothesis ? createHypothesisReasoning(memory, selectedHypothesis) : null),
    [memory, selectedHypothesis]
  );
  const hypothesisWhiteBoxTrace = React.useMemo(
    () => (selectedHypothesis ? createHypothesisWhiteBoxTrace(memory, selectedHypothesis) : null),
    [memory, selectedHypothesis]
  );
  const demoWalkthrough = React.useMemo(
    () => createMemoryDemoWalkthrough(memory, hypotheses, selectedHypothesis, locale),
    [hypotheses, locale, memory, selectedHypothesis]
  );
  const selectedLlmHypothesis = React.useMemo(
    () => llmHypotheses.find((hypothesis) => hypothesis.id === selectedHypothesis?.id) ?? llmHypotheses[0] ?? null,
    [llmHypotheses, selectedHypothesis?.id]
  );
  const llmTrace = React.useMemo(
    () => createHomeMemoryLlmTrace({
      hypothesis: selectedLlmHypothesis,
      portrait: llmPortrait,
      batchPlan: llmBatchPlan,
      metrics: llmMetrics,
      error: llmTraceError
    }),
    [llmBatchPlan, llmMetrics, llmPortrait, llmTraceError, selectedLlmHypothesis]
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

  React.useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const config = await getJson<HomeMemoryLlmApiConfig>('/api/memory/llm/config');
        if (disposed) return;
        setLlmConfig(config);
        setLlmConfigDraft(config);
      } catch (error) {
        if (!disposed) {
          console.warn('[home-memory-llm] config_get_failed', errorMessage(error));
          setLlmTraceError(errorMessage(error));
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  React.useEffect(() => {
    if (!memory.runId) {
      return undefined;
    }
    let disposed = false;
    const timer = window.setTimeout(async () => {
      try {
        const [batchPlan, metrics] = await Promise.all([
          getJson<HomeMemoryLlmApiBatchPlan>('/api/memory/llm/batch-plan?includePortraitSummary=true'),
          getJson<HomeMemoryLlmApiMetrics>('/api/memory/llm/metrics')
        ]);
        if (disposed) return;
        setLlmBatchPlan(batchPlan);
        setLlmMetrics(metrics);
        setLlmTraceError(null);
      } catch (error) {
        if (!disposed) {
          setLlmTraceError(errorMessage(error));
        }
      }
    }, 600);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [memory.runId, memory.totalEvents]);

  function clearMemory(): void {
    setMemory(createHomeMemory());
    setRecentEvents([]);
    setSelectedNodeId(null);
    setMemoryWarning(null);
    setActiveEvidenceEvent(null);
    setSelectedLedgerEventId(null);
    setLlmHypotheses([]);
    setLlmPortrait(null);
    setLlmBatchPlan(null);
    setLlmMetrics(null);
    setLlmStreamLog([]);
    setLlmStreamOutput('');
    setLlmTraceError(null);
  }

  async function refreshHomeMemoryLlmTrace(): Promise<void> {
    const hypothesisTraceUrl = '/api/memory/profile/hypotheses?includeLlmEnrichment=true&includeReliability=true';
    const typeQuery = selectedHypothesis ? `&type=${encodeURIComponent(selectedHypothesis.type)}` : '';
    setLlmTraceLoading(true);
    try {
      const [hypothesisResponse, portrait, batchPlan, metrics] = await Promise.all([
        getJson<HomeMemoryLlmApiHypothesisResponse>(`${hypothesisTraceUrl}${typeQuery}`),
        getJson<HomeMemoryLlmApiPortrait>('/api/memory/portrait?includeLlmEnrichment=true'),
        getJson<HomeMemoryLlmApiBatchPlan>('/api/memory/llm/batch-plan?includePortraitSummary=true'),
        getJson<HomeMemoryLlmApiMetrics>('/api/memory/llm/metrics')
      ]);
      setLlmHypotheses(hypothesisResponse.items);
      setLlmPortrait(portrait);
      setLlmBatchPlan(batchPlan);
      setLlmMetrics(metrics);
      setLlmTraceError(null);
    } catch (error) {
      console.warn('[home-memory-llm] trace_refresh_failed', errorMessage(error));
      setLlmTraceError(errorMessage(error));
    } finally {
      setLlmTraceLoading(false);
    }
  }

  async function saveHomeMemoryLlmConfig(): Promise<void> {
    if (!llmConfigDraft) {
      return;
    }
    setLlmConfigSaving(true);
    try {
      const saved = await putJson<HomeMemoryLlmApiConfig>('/api/memory/llm/config', {
        provider: {
          enabled: llmConfigDraft.provider.enabled,
          baseUrl: llmConfigDraft.provider.baseUrl,
          model: llmConfigDraft.provider.model,
          timeoutMs: llmConfigDraft.provider.timeoutMs,
          maxRetries: llmConfigDraft.provider.maxRetries,
          ...(llmApiKeyDraft.trim() ? { apiKey: llmApiKeyDraft.trim() } : {})
        },
        budget: llmConfigDraft.budget,
        gates: llmConfigDraft.gates
      });
      setLlmConfig(saved);
      setLlmConfigDraft(saved);
      setLlmApiKeyDraft('');
      const metrics = await getJson<HomeMemoryLlmApiMetrics>('/api/memory/llm/metrics');
      setLlmMetrics(metrics);
      setLlmTraceError(null);
    } catch (error) {
      console.warn('[home-memory-llm] config_save_failed', errorMessage(error));
      setLlmTraceError(errorMessage(error));
    } finally {
      setLlmConfigSaving(false);
    }
  }

  async function startHomeMemoryLlmStream(): Promise<void> {
    if (!selectedHypothesis) {
      setLlmTraceError('No selected hypothesis is available for streaming.');
      return;
    }
    setLlmStreamLoading(true);
    setLlmStreamLog([]);
    setLlmStreamOutput('');
    try {
      console.info('[home-memory-llm] stream_connect', { purpose: 'hypothesis_explanation', type: selectedHypothesis.type });
      const response = await fetch(`/api/memory/llm/stream?purpose=hypothesis_explanation&type=${encodeURIComponent(selectedHypothesis.type)}`);
      if (!response.ok) {
        throw new Error(`Stream request failed with ${response.status}`);
      }
      await readMemoryLlmStream(response, (entry) => {
        setLlmStreamLog((current) => [...current.slice(-19), entry]);
        const content = typeof entry.data.content === 'string' ? entry.data.content : '';
        if (entry.event === 'provider_delta' && content) {
          setLlmStreamOutput((current) => `${current}${content}`);
        }
      });
      const [batchPlan, metrics] = await Promise.all([
        getJson<HomeMemoryLlmApiBatchPlan>('/api/memory/llm/batch-plan?includePortraitSummary=true'),
        getJson<HomeMemoryLlmApiMetrics>('/api/memory/llm/metrics')
      ]);
      setLlmBatchPlan(batchPlan);
      setLlmMetrics(metrics);
      setLlmTraceError(null);
    } catch (error) {
      console.error('[home-memory-llm] stream_failed', errorMessage(error));
      setLlmTraceError(errorMessage(error));
    } finally {
      setLlmStreamLoading(false);
    }
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
          <StateLedgerPanel
            ledger={eventStateLedger}
            events={recentEvents}
            selectedEventId={selectedLedgerEvent?.id ?? null}
            copy={copy}
            onSelectEvent={setSelectedLedgerEventId}
          />
          <HomeMemoryLlmTracePanel
            trace={llmTrace}
            loading={llmTraceLoading}
            config={llmConfig}
            configDraft={llmConfigDraft}
            apiKeyDraft={llmApiKeyDraft}
            configSaving={llmConfigSaving}
            streamLoading={llmStreamLoading}
            streamLog={llmStreamLog}
            streamOutput={llmStreamOutput}
            copy={copy}
            onConfigDraftChange={setLlmConfigDraft}
            onApiKeyDraftChange={setLlmApiKeyDraft}
            onSaveConfig={saveHomeMemoryLlmConfig}
            onStartStream={startHomeMemoryLlmStream}
            onRefresh={refreshHomeMemoryLlmTrace}
          />
          <SelectedMemoryPanel
            memory={memory}
            hypotheses={hypotheses}
            selectedNode={selectedNode}
            copy={copy}
          />
        </aside>
      </div>

      <MemoryDemoWalkthroughPanel walkthrough={demoWalkthrough} copy={copy} />

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

const DEFAULT_DEMO_WALKTHROUGH_COPY = {
  eyebrow: 'Demo walkthrough',
  title: 'Presenter script',
  subtitle: 'Follow this order to explain how device events become home memory, profile conclusions, and white-box calculation.',
  evidence: 'What to point at',
  reference: 'Where to drill down'
};

const DEFAULT_DEMO_WALKTHROUGH_COPY_ZH = {
  eyebrow: '演示讲解',
  title: '串讲脚本',
  subtitle: '按照这个顺序讲，可以从设备事件一路讲到家庭记忆、画像结论和白盒计算。',
  evidence: '讲解依据',
  reference: '下钻位置'
};

function MemoryDemoWalkthroughPanel({ walkthrough, copy }: { walkthrough: MemoryDemoWalkthrough; copy: MemoryCopy }): React.ReactElement {
  const panelCopy = copy.demoWalkthrough ?? (copy.whiteBox.eyebrow === 'White-box reasoning' ? DEFAULT_DEMO_WALKTHROUGH_COPY : DEFAULT_DEMO_WALKTHROUGH_COPY_ZH);

  return (
    <section className="memory-panel memory-demo-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{panelCopy.eyebrow}</span>
          <h2>{panelCopy.title}</h2>
          <p>{panelCopy.subtitle}</p>
        </div>
      </div>
      <div className="memory-demo-hero">
        <div>
          <span>{walkthrough.title}</span>
          <strong>{walkthrough.subject}</strong>
          <p>{walkthrough.summary}</p>
        </div>
      </div>
      <ol className="memory-demo-stages">
        {walkthrough.stages.map((stage) => (
          <li key={stage.id} className="memory-demo-stage">
            <div>
              <strong>{stage.title}</strong>
              <p>{stage.talkTrack}</p>
            </div>
            <div className="memory-demo-stage-evidence">
              <span>{panelCopy.evidence}</span>
              <p>{stage.evidence}</p>
            </div>
            <div className="memory-demo-stage-metrics">
              {stage.metrics.map((metric) => (
                <span key={`${stage.id}:${metric.label}`}>
                  <small>{translateRowLabel(metric.label, copy)}</small>
                  <b>{metric.value}</b>
                </span>
              ))}
            </div>
            <small className="memory-demo-reference">{panelCopy.reference}: {stage.reference}</small>
          </li>
        ))}
      </ol>
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

function HomeMemoryLlmTracePanel({
  trace,
  loading,
  config,
  configDraft,
  apiKeyDraft,
  configSaving,
  streamLoading,
  streamLog,
  streamOutput,
  copy,
  onConfigDraftChange,
  onApiKeyDraftChange,
  onSaveConfig,
  onStartStream,
  onRefresh
}: {
  trace: HomeMemoryLlmTrace;
  loading: boolean;
  config: HomeMemoryLlmApiConfig | null;
  configDraft: HomeMemoryLlmApiConfig | null;
  apiKeyDraft: string;
  configSaving: boolean;
  streamLoading: boolean;
  streamLog: HomeMemoryLlmStreamLogEntry[];
  streamOutput: string;
  copy: MemoryCopy;
  onConfigDraftChange: (config: HomeMemoryLlmApiConfig) => void;
  onApiKeyDraftChange: (value: string) => void;
  onSaveConfig: () => Promise<void>;
  onStartStream: () => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.ReactElement {
  function updateDraft(update: (config: HomeMemoryLlmApiConfig) => HomeMemoryLlmApiConfig): void {
    if (configDraft) {
      onConfigDraftChange(update(configDraft));
    }
  }

  return (
    <section className="memory-panel llm-trace-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">LLM Trace</span>
          <h2>{trace.enabled ? 'Provider participation' : 'Deterministic boundary'}</h2>
        </div>
        <button onClick={() => void onRefresh()} disabled={loading}>
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {configDraft ? (
        <div className="llm-config-panel">
          <div className="llm-config-title">
            <strong>Runtime provider config</strong>
            <span>{config?.provider.apiKeyConfigured ? 'API key configured' : 'No API key configured'}</span>
          </div>
          <div className="llm-config-grid">
            <label>
              <span>Enabled</span>
              <input
                type="checkbox"
                checked={configDraft.provider.enabled}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  provider: { ...current.provider, enabled: event.currentTarget.checked }
                }))}
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                value={configDraft.provider.baseUrl}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  provider: { ...current.provider, baseUrl: event.currentTarget.value }
                }))}
                placeholder="https://provider.example/v1"
              />
            </label>
            <label>
              <span>Model</span>
              <input
                value={configDraft.provider.model}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  provider: { ...current.provider, model: event.currentTarget.value }
                }))}
              />
            </label>
            <label>
              <span>API key</span>
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)}
                placeholder={config?.provider.apiKeyConfigured ? 'Leave blank to keep current key' : 'Optional bearer token'}
              />
            </label>
            <label>
              <span>Timeout ms</span>
              <input
                type="number"
                min={1000}
                value={configDraft.provider.timeoutMs}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  provider: { ...current.provider, timeoutMs: Number(event.currentTarget.value) }
                }))}
              />
            </label>
            <label>
              <span>Retries</span>
              <input
                type="number"
                min={0}
                value={configDraft.provider.maxRetries}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  provider: { ...current.provider, maxRetries: Number(event.currentTarget.value) }
                }))}
              />
            </label>
            <label>
              <span>Calls / hour</span>
              <input
                type="number"
                min={1}
                value={configDraft.budget.maxCallsPerHomePerHour}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  budget: { ...current.budget, maxCallsPerHomePerHour: Number(event.currentTarget.value) }
                }))}
              />
            </label>
            <label>
              <span>Calls / day</span>
              <input
                type="number"
                min={1}
                value={configDraft.budget.maxCallsPerHomePerDay}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  budget: { ...current.budget, maxCallsPerHomePerDay: Number(event.currentTarget.value) }
                }))}
              />
            </label>
            <label>
              <span>Batch size</span>
              <input
                type="number"
                min={1}
                value={configDraft.budget.maxBatchSize}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  budget: { ...current.budget, maxBatchSize: Number(event.currentTarget.value) }
                }))}
              />
            </label>
            <label>
              <span>Unknown evidence</span>
              <input
                type="number"
                min={1}
                value={configDraft.gates.minEvidenceCountForUnknownSchema}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  gates: { ...current.gates, minEvidenceCountForUnknownSchema: Number(event.currentTarget.value) }
                }))}
              />
            </label>
            <label>
              <span>Review min</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={configDraft.gates.minConfidenceForReview}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  gates: { ...current.gates, minConfidenceForReview: Number(event.currentTarget.value) }
                }))}
              />
            </label>
            <label>
              <span>Review max</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={configDraft.gates.maxConfidenceForReview}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  gates: { ...current.gates, maxConfidenceForReview: Number(event.currentTarget.value) }
                }))}
              />
            </label>
          </div>
          <div className="llm-config-actions">
            <button onClick={() => void onSaveConfig()} disabled={configSaving}>
              {configSaving ? 'Saving' : 'Save config'}
            </button>
            <button onClick={() => void onStartStream()} disabled={streamLoading}>
              {streamLoading ? 'Streaming' : 'Stream selected hypothesis'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="llm-purpose-panel">
        <div className="llm-purpose-title">
          <strong>{copy.llmTrace.purposeTitle}</strong>
          <span>{copy.llmTrace.purposeSubtitle}</span>
        </div>
        <div className="llm-purpose-grid">
          {copy.llmTrace.purposes.map((item) => (
            <article key={item.purpose}>
              <header>
                <strong>{item.label}</strong>
                <span>{item.trigger}</span>
              </header>
              <p>{item.output}</p>
              <small>{item.why}</small>
            </article>
          ))}
        </div>
      </div>

      <div className="llm-trace-metrics">
        {trace.metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      {trace.error ? <p className="memory-warning compact">{trace.error}</p> : null}

      <div className="llm-trace-rows">
        {trace.rows.map((row) => (
          <article key={row.label} className="llm-trace-row">
            <header>
              <strong>{row.label}</strong>
              <span className={`llm-trace-source ${row.source}`}>{row.source}</span>
            </header>
            <p>{row.claim}</p>
            <div className="llm-trace-evidence">
              <span>Missing {row.missingEvidence.length}</span>
              <span>Contradicting {row.contradictingEvidenceIds.length}</span>
              <span>Alternatives {row.alternatives.length}</span>
            </div>
            {row.errors.length > 0 ? (
              <ul>
                {row.errors.slice(0, 2).map((error) => <li key={error}>{error}</li>)}
              </ul>
            ) : null}
          </article>
        ))}
        {trace.rows.length === 0 ? <p className="muted">No LLM enrichment has been requested for the selected memory yet.</p> : null}
      </div>

      <div className="llm-trace-batch">
        <div>
          <strong>Batch gatekeeper</strong>
          <span>{trace.cacheSize} cached enrichments</span>
        </div>
        {trace.batchItems.map((item) => (
          <div key={`${item.purpose}:${item.targetId}`} className="llm-trace-batch-row">
            <span className={`llm-trace-source ${item.source}`}>{item.source}</span>
            <strong>{item.purpose.replaceAll('_', ' ')}</strong>
            <small title={item.targetId}>{item.reason}</small>
          </div>
        ))}
        {trace.batchItems.length === 0 ? <p className="muted">No eligible batch work is currently planned.</p> : null}
      </div>

      <div className="llm-stream-panel">
        <div>
          <strong>Live provider output</strong>
          <span>{streamLog.length} {copy.llmTrace.streamEventSuffix}</span>
        </div>
        <pre className="llm-stream-output">{streamOutput || 'No streamed provider content yet.'}</pre>
        <div className="llm-stream-log">
          {streamLog.map((entry, index) => (
            <div key={`${entry.event}:${index}`}>
              <span className={`llm-trace-source ${entry.event === 'provider_delta' ? 'llm' : 'planned'}`}>{entry.event}</span>
              <code>{formatStreamData(entry.data)}</code>
            </div>
          ))}
          {streamLog.length === 0 ? <p className="muted">Run a stream to see gatekeeper, provider, validator, and result events.</p> : null}
        </div>
      </div>
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

function StateLedgerPanel({
  ledger,
  events,
  selectedEventId,
  copy,
  onSelectEvent
}: {
  ledger: EventStateLedger | null;
  events: DeviceValueEvent[];
  selectedEventId: string | null;
  copy: MemoryCopy;
  onSelectEvent: (eventId: string) => void;
}): React.ReactElement {
  return (
    <section className="memory-panel state-ledger-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.stateLedger.eyebrow}</span>
          <h2>{copy.stateLedger.title}</h2>
          <p>{copy.stateLedger.subtitle}</p>
        </div>
      </div>
      {events.length > 0 ? (
        <div className="state-ledger-event-selector" aria-label={copy.stateLedger.eventSelector}>
          {events.slice(0, 8).map((event) => (
            <button
              key={event.id}
              className={event.id === selectedEventId ? 'active' : ''}
              onClick={() => onSelectEvent(event.id)}
              aria-pressed={event.id === selectedEventId}
            >
              <span>{event.deviceId}.{event.field}</span>
              <small>{formatValue(event.value)} / {formatTime(event.simTime)}</small>
            </button>
          ))}
        </div>
      ) : null}
      {ledger ? (
        <div className="state-ledger-steps">
          {ledger.steps.map((step) => (
            <article key={step.id} className="state-ledger-step">
              <header>
                <strong>{step.title}</strong>
                {step.relatedHypothesisIds?.length ? <span>{step.relatedHypothesisIds.length} {copy.stateLedger.hypotheses}</span> : null}
              </header>
              <section className="state-ledger-narration">
                <span>{copy.stateLedger.narration}</span>
                <p>{step.narration}</p>
              </section>
              <section className="state-ledger-formula">
                <span>{copy.stateLedger.formula}</span>
                <code>{step.formula}</code>
                <p>{step.why}</p>
              </section>
              {step.metrics.length > 0 ? (
                <div className="state-ledger-metrics">
                  {step.metrics.map((metric) => (
                    <div key={`${step.id}:${metric.label}`}>
                      <span>{translateRowLabel(metric.label, copy)}</span>
                      <strong>{metric.value}</strong>
                      {metric.note ? <small>{metric.note}</small> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {step.changes.length > 0 ? (
                <div className="state-ledger-changes">
                  <span>{copy.stateLedger.changes}</span>
                  {step.changes.map((changeItem) => (
                    <div key={`${step.id}:${changeItem.path}`} className="state-ledger-change-row">
                      <strong>{changeItem.path}</strong>
                      <code>{changeItem.before}</code>
                      <i>-&gt;</i>
                      <code>{changeItem.after}</code>
                      <small>{changeItem.formula} / {changeItem.why}</small>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">{copy.stateLedger.empty}</p>
      )}
    </section>
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
      <div className="whitebox-guided-chain">
        <div>
          <strong>{copy.whiteBox.guidedTitle}</strong>
          <p>{copy.whiteBox.guidedSubtitle}</p>
        </div>
        <ol>
          {guidedExplanationSteps(trace, copy).map((step, index) => (
            <li key={`${step.title}:${index}`} className="whitebox-guided-step">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
                {step.reference ? <small>{step.reference}</small> : null}
              </div>
            </li>
          ))}
        </ol>
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

function guidedExplanationSteps(trace: HypothesisWhiteBoxTrace, copy: MemoryCopy): Array<{ title: string; detail: string; reference?: string }> {
  const zh = copy.whiteBox.eyebrow !== 'White-box reasoning';
  const directEvidence = whiteBoxSection(trace, 'Direct evidence');
  const semantic = whiteBoxSection(trace, 'Semantic interpretation');
  const aggregate = whiteBoxSection(trace, 'Aggregate features');
  const ruleInputs = whiteBoxSection(trace, 'Rule inputs');
  const candidateScoring = whiteBoxSection(trace, 'Candidate scoring');
  const scoreLedger = whiteBoxSection(trace, 'Score ledger');
  const confidence = whiteBoxSection(trace, 'Confidence calculation');
  const gaps = whiteBoxSection(trace, 'Missing or weak evidence');

  if (trace.conclusion.type === 'household_size' && aggregate && candidateScoring && scoreLedger) {
    const lowerBound = rowValue(aggregate, 'Lower bound');
    const sleepZones = rowValue(aggregate, 'Sleep zones');
    const routineClusters = rowValue(aggregate, 'Routine clusters');
    const weightedEvidence = rowValue(aggregate, 'Weighted evidence');
    const strongestCandidate = strongestCandidateText(candidateScoring);
    const confidenceRow = rowValue(confidence, 'Final confidence') ?? trace.conclusion.confidence;

    return zh
      ? [
          {
            title: '先明确要解释的结论',
            detail: `当前结论是「${trace.conclusion.label}」，置信度为 ${trace.conclusion.confidence}。这不是模拟真值，而是由设备事件推出来的画像假设。`,
            reference: '对应账本：观测结论'
          },
          {
            title: '再说明输入来自哪些设备事实',
            detail: `系统先收集 ${directEvidence?.rows.length ?? 0} 条直接设备证据，例如设备字段变化、房间、时间、证据强度和画像权重。`,
            reference: '对应账本：直接证据'
          },
          {
            title: '把设备事实翻译成语义信号',
            detail: `这些事件会被归一成 ${semantic?.rows.length ?? 0} 条语义信号，例如 presence、sleep、environment 或 cooking 等信号，高层推理只读取这些可解释语义。`,
            reference: '对应账本：语义解释'
          },
          {
            title: '提取住户数量相关的聚合特征',
            detail: `用于人数推断的关键特征包括：下界 ${lowerBound ?? 'unknown'}、睡眠区 ${sleepZones ?? 'unknown'}、routine cluster ${routineClusters ?? 'unknown'}、加权证据 ${weightedEvidence ?? 'unknown'}。`,
            reference: '对应账本：聚合特征'
          },
          {
            title: '分别给每个候选人数打分',
            detail: `每个候选人数都从 base score 开始，再根据下界距离、routine、sleep zone、resident slot、shared sleep、弱环境证据等项加分或扣分。当前最高候选是 ${strongestCandidate}。`,
            reference: '对应账本：候选评分、评分账本'
          },
          {
            title: '把原始分数归一化成概率',
            detail: '每个候选人数的 clamped score 会除以 total score，得到 1/2/3/4/5 人的概率分布；评分账本里能看到每一项公式和每个候选的合计。',
            reference: '对应账本：评分账本'
          },
          {
            title: '最后计算置信度并保留不确定性',
            detail: `最终置信度为 ${confidenceRow}。它还会受到样本量上限、winning probability、lower-bound boost、weak-context penalty 等限制，所以结果仍然是概率判断。`,
            reference: '对应账本：置信度计算、缺失或弱证据'
          }
        ]
      : [
          {
            title: 'Start with the conclusion being explained',
            detail: `The selected conclusion is "${trace.conclusion.label}" with ${trace.conclusion.confidence} confidence. It is a profile hypothesis inferred from device events, not simulation truth.`,
            reference: 'Ledger: Observed conclusion'
          },
          {
            title: 'Show the observed device facts',
            detail: `The system first collects ${directEvidence?.rows.length ?? 0} direct evidence rows: device field changes, rooms, times, evidence strengths, and profile weights.`,
            reference: 'Ledger: Direct evidence'
          },
          {
            title: 'Translate facts into semantic signals',
            detail: `Those events are normalized into ${semantic?.rows.length ?? 0} semantic signals, such as presence, sleep, environment, or cooking signals. Higher-level rules read these meanings.`,
            reference: 'Ledger: Semantic interpretation'
          },
          {
            title: 'Extract household-size features',
            detail: `The resident-count features are lower bound ${lowerBound ?? 'unknown'}, sleep zones ${sleepZones ?? 'unknown'}, routine clusters ${routineClusters ?? 'unknown'}, and weighted evidence ${weightedEvidence ?? 'unknown'}.`,
            reference: 'Ledger: Aggregate features'
          },
          {
            title: 'Score every resident-count candidate',
            detail: `Each candidate starts with a base score and then receives additions or penalties for lower-bound distance, routines, sleep zones, resident slots, shared sleep, and weak context. The strongest candidate is ${strongestCandidate}.`,
            reference: 'Ledger: Candidate scoring, Score ledger'
          },
          {
            title: 'Normalize raw scores into probabilities',
            detail: 'Each candidate clamped score is divided by the total score to produce the 1/2/3/4/5 resident probability distribution. The score ledger shows every formula term.',
            reference: 'Ledger: Score ledger'
          },
          {
            title: 'Apply confidence caps and uncertainty',
            detail: `Final confidence is ${confidenceRow}. It is limited by sample cap, winning probability, lower-bound boost, and weak-context penalty, so the output remains probabilistic.`,
            reference: 'Ledger: Confidence calculation, Missing or weak evidence'
          }
        ];
  }

  return zh
    ? [
        {
          title: '先明确结论',
          detail: `当前结论是「${trace.conclusion.label}」，置信度为 ${trace.conclusion.confidence}。`,
          reference: '对应账本：观测结论'
        },
        {
          title: '展示直接证据',
          detail: `这个结论引用了 ${directEvidence?.rows.length ?? 0} 条设备证据。`,
          reference: '对应账本：直接证据'
        },
        {
          title: '解释语义归一',
          detail: `设备证据被转换成 ${semantic?.rows.length ?? 0} 条语义信号，供画像规则读取。`,
          reference: '对应账本：语义解释'
        },
        {
          title: '说明规则输入',
          detail: `规则读取 ${ruleInputs?.rows.length ?? 0} 类输入，包括事件数量、房间、设备、时间桶、语义信号和图谱主体。`,
          reference: '对应账本：规则输入'
        },
        {
          title: '说明置信度和缺口',
          detail: `最后得到 ${trace.conclusion.confidence} 置信度；还需要查看 ${gaps?.rows.length ?? 0} 条缺失或弱证据来理解不确定性。`,
          reference: '对应账本：置信度计算、缺失或弱证据'
        }
      ]
    : [
        {
          title: 'Start with the selected conclusion',
          detail: `The selected conclusion is "${trace.conclusion.label}" with ${trace.conclusion.confidence} confidence.`,
          reference: 'Ledger: Observed conclusion'
        },
        {
          title: 'Show direct evidence',
          detail: `This conclusion references ${directEvidence?.rows.length ?? 0} observed device evidence rows.`,
          reference: 'Ledger: Direct evidence'
        },
        {
          title: 'Explain semantic normalization',
          detail: `Device evidence is converted into ${semantic?.rows.length ?? 0} semantic signals before profile rules read it.`,
          reference: 'Ledger: Semantic interpretation'
        },
        {
          title: 'Explain rule inputs',
          detail: `The rule reads ${ruleInputs?.rows.length ?? 0} input groups, including events, rooms, devices, time buckets, semantic signals, and graph subjects.`,
          reference: 'Ledger: Rule inputs'
        },
        {
          title: 'Explain confidence and gaps',
          detail: `The final confidence is ${trace.conclusion.confidence}; ${gaps?.rows.length ?? 0} missing or weak evidence rows explain remaining uncertainty.`,
          reference: 'Ledger: Confidence calculation, Missing or weak evidence'
        }
      ];
}

function whiteBoxSection(trace: HypothesisWhiteBoxTrace, title: string): HypothesisWhiteBoxTrace['sections'][number] | undefined {
  return trace.sections.find((section) => section.title === title);
}

function rowValue(section: HypothesisWhiteBoxTrace['sections'][number] | undefined, label: string): string | undefined {
  return section?.rows.find((row) => row.label === label)?.value;
}

function strongestCandidateText(section: HypothesisWhiteBoxTrace['sections'][number]): string {
  const scored = section.rows
    .map((row) => ({ label: row.label, probability: Number(row.value.replace('%', '')) }))
    .filter((row) => Number.isFinite(row.probability))
    .sort((left, right) => right.probability - left.probability)[0];
  return scored ? `${scored.label} (${scored.probability}%)` : 'unknown';
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

async function readMemoryLlmStream(
  response: Response,
  onEntry: (entry: HomeMemoryLlmStreamLogEntry) => void
): Promise<void> {
  if (!response.body) {
    parseMemoryLlmSseBlocks(await response.text(), onEntry);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = parseMemoryLlmSseBlocks(buffer, onEntry);
  }
  buffer += decoder.decode();
  parseMemoryLlmSseBlocks(buffer, onEntry, true);
}

function parseMemoryLlmSseBlocks(
  text: string,
  onEntry: (entry: HomeMemoryLlmStreamLogEntry) => void,
  flush = false
): string {
  const blocks = text.split(/\n\n+/);
  const completeBlocks = flush ? blocks : blocks.slice(0, -1);
  for (const block of completeBlocks) {
    const event = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (!event || !data) {
      continue;
    }
    try {
      onEntry({ event, data: JSON.parse(data) as Record<string, unknown> });
    } catch (error) {
      console.warn('[home-memory-llm] stream_parse_failed', errorMessage(error));
    }
  }
  return flush ? '' : blocks[blocks.length - 1] ?? '';
}

function formatStreamData(data: Record<string, unknown>): string {
  if (typeof data.content === 'string') {
    return data.content.length > 80 ? `${data.content.slice(0, 80)}...` : data.content;
  }
  if (typeof data.reason === 'string') {
    return data.reason;
  }
  if (typeof data.source === 'string') {
    return data.source;
  }
  return JSON.stringify(data);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
