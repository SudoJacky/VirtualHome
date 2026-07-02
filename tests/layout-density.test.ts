import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dashboard layout density', () => {
  const mainTsx = readFileSync(path.resolve('src/web/main.tsx'), 'utf8');
  const floorplan3dTsx = readFileSync(path.resolve('src/web/Floorplan3D.tsx'), 'utf8');
  const homeMemory3dTsx = readFileSync(path.resolve('src/web/HomeMemory3D.tsx'), 'utf8');
  const homeMemoryViewTsx = readFileSync(path.resolve('src/web/HomeMemoryView.tsx'), 'utf8');
  const styles = readFileSync(path.resolve('src/web/styles.css'), 'utf8');

  it('keeps primary and secondary dashboard areas in separate dense grids', () => {
    expect(mainTsx).toContain('className="dashboard-side-stack"');
    expect(mainTsx).toContain('className="secondary-grid"');
    expect(styles).toContain('.dashboard-side-stack');
    expect(styles).toContain('.secondary-grid');
  });

  it('renders the 3d floorplan before narrative dashboard modules so it is visible above the fold', () => {
    const floorplanIndex = mainTsx.indexOf('className="main-grid"');
    const briefingIndex = mainTsx.indexOf('className={`panel home-briefing');
    const storyIndex = mainTsx.indexOf('className="story-row"');
    const behaviorIndex = mainTsx.indexOf('className="behavior-grid"');

    expect(floorplanIndex).toBeGreaterThan(-1);
    expect(briefingIndex).toBeGreaterThan(-1);
    expect(storyIndex).toBeGreaterThan(-1);
    expect(behaviorIndex).toBeGreaterThan(-1);
    expect(floorplanIndex).toBeLessThan(briefingIndex);
    expect(floorplanIndex).toBeLessThan(storyIndex);
    expect(floorplanIndex).toBeLessThan(behaviorIndex);
  });

  it('does not pin the floorplan across unrelated rows or force a tall blank canvas', () => {
    expect(styles).not.toContain('grid-row: span 4');
    expect(styles).toContain('height: clamp(440px, 52vh, 560px) !important;');
    expect(styles).toContain('min-height: clamp(440px, 52vh, 560px);');
  });

  it('gives the 3d shell a fixed viewport height for the WebGL canvas wrapper', () => {
    expect(styles).toMatch(/\.floorplan3d-shell\s*\{[^}]*\n\s*height: clamp\(440px, 52vh, 560px\);/s);
  });

  it('keeps tall workflow panels out of the 3d grid row', () => {
    const secondaryGridIndex = mainTsx.indexOf('className="secondary-grid"');
    const alertPanelIndex = mainTsx.indexOf('className="panel alert-response-panel"');
    const insightsPanelIndex = mainTsx.indexOf('<h2>Home Insights</h2>');

    expect(secondaryGridIndex).toBeGreaterThan(-1);
    expect(alertPanelIndex).toBeGreaterThan(secondaryGridIndex);
    expect(insightsPanelIndex).toBeGreaterThan(secondaryGridIndex);
  });

  it('uses context-aware device focus actions instead of a hard-coded TV shortcut', () => {
    expect(mainTsx).not.toContain('Focus TV');
    expect(mainTsx).toContain('className="device-focus-list"');
    expect(mainTsx).toContain('devices.slice(0, 6).map');
    expect(mainTsx).toContain('Focus device');
  });

  it('avoids perpetual vertical bobbing for people, device meshes, and device labels', () => {
    expect(floorplan3dTsx).not.toContain('baseY + bob');
    expect(floorplan3dTsx).not.toContain('device.y + pulse');
    expect(styles).not.toContain('animation: deviceLabelPulse');
    expect(styles).not.toContain('translateY(-1px)');
  });

  it('defaults the memory 3d view to a room-centered spatial map with a topology fallback', () => {
    expect(homeMemoryViewTsx).toContain("React.useState<HomeMemoryGraphLayoutMode>('spatial')");
    expect(homeMemoryViewTsx).toContain('createHomeMemoryGraphModel(memory, hypotheses, { layoutMode: memoryGraphMode })');
    expect(homeMemoryViewTsx).toContain('aria-label={copy.graph.viewModeLabel}');
    expect(homeMemoryViewTsx).toContain("setMemoryGraphMode('topology')");
    expect(homeMemoryViewTsx).toContain('memory-view-mode-toggle');
  });

  it('adds a lightweight language toggle for home memory explanatory copy', () => {
    expect(homeMemoryViewTsx).toContain('memoryCopy(locale)');
    expect(homeMemoryViewTsx).toContain('className="memory-language-toggle"');
    expect(homeMemoryViewTsx).toContain("setLocale('zh')");
    expect(styles).toContain('.memory-language-toggle');
  });

  it('keeps the spatial memory graph quiet until focus or event highlight', () => {
    expect(homeMemory3dTsx).toContain('const renderedEdges = visibleMemoryEdges(graph.edges, highlightedEdgeIdSet, layoutMode)');
    expect(homeMemory3dTsx).toContain('layoutMode={layoutMode}');
    expect(homeMemory3dTsx).toContain('nodeRadius(node, layoutMode)');
    expect(homeMemory3dTsx).toContain('shouldShowNodeLabel(node.kind, layoutMode, selected, related, highlighted)');
    expect(homeMemory3dTsx).toContain("return selected || related || highlighted || kind === 'home' || kind === 'room';");
    expect(homeMemory3dTsx).toContain("return highlighted || edge.kind === 'contains';");
  });

  it('renders white-box memory reasoning as a full-width flow diagram', () => {
    expect(homeMemoryViewTsx).toContain('className="memory-panel whitebox-trace-panel"');
    expect(homeMemoryViewTsx).toContain('className="whitebox-flow-diagram"');
    expect(homeMemoryViewTsx.indexOf('className="whitebox-flow-diagram"')).toBeGreaterThan(homeMemoryViewTsx.indexOf('className="memory-main"'));
    expect(styles).toContain('.whitebox-flow-card:not(:last-child)::after');
    expect(styles).toContain('grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));');
  });

  it('keeps dense white-box stage content scrollable inside each flow card', () => {
    expect(styles).toMatch(/\.whitebox-flow-card\s*\{[^}]*height: clamp\(320px, 42vh, 460px\);/s);
    expect(styles).toMatch(/\.whitebox-flow-card\s*\{[^}]*overflow: hidden;/s);
    expect(styles).toMatch(/\.whitebox-card-body\s*\{[^}]*overflow: auto;/s);
  });

  it('renders a complete white-box ledger below the compact flow cards', () => {
    expect(homeMemoryViewTsx).toContain('className="whitebox-ledger"');
    expect(homeMemoryViewTsx).toContain('copy.whiteBox.ledgerTitle');
    expect(homeMemoryViewTsx).toContain('className="whitebox-ledger-row"');
    expect(styles).toContain('.whitebox-ledger-row');
  });

  it('renders a guided white-box explanation chain before the full ledger', () => {
    expect(homeMemoryViewTsx).toContain('className="whitebox-guided-chain"');
    expect(homeMemoryViewTsx).toContain('guidedExplanationSteps(trace, copy)');
    expect(homeMemoryViewTsx.indexOf('className="whitebox-guided-chain"')).toBeLessThan(homeMemoryViewTsx.indexOf('className="whitebox-ledger"'));
    expect(styles).toContain('.whitebox-guided-step:not(:last-child)::after');
  });

  it('surfaces Home Memory LLM participation in a dedicated trace panel', () => {
    expect(homeMemoryViewTsx).toContain('HomeMemoryLlmTracePanel');
    expect(homeMemoryViewTsx).toContain('/api/memory/profile/hypotheses?includeLlmEnrichment=true&includeReliability=true');
    expect(homeMemoryViewTsx).toContain('/api/memory/llm/batch-plan?includePortraitSummary=true');
    expect(homeMemoryViewTsx).toContain('/api/memory/llm/metrics');
    expect(homeMemoryViewTsx).toContain('className="memory-panel llm-trace-panel"');
    expect(homeMemoryViewTsx).toContain('copy.llmTrace.purposeTitle');
    expect(homeMemoryViewTsx).toContain('copy.llmTrace.purposes.map');
    expect(styles).toContain('.llm-trace-panel');
    expect(styles).toContain('.llm-purpose-grid');
    expect(styles).toContain('.llm-trace-source');
  });

  it('renders configurable and streaming LLM controls', () => {
    expect(homeMemoryViewTsx).toContain('/api/memory/llm/config');
    expect(homeMemoryViewTsx).toContain('/api/memory/llm/stream');
    expect(homeMemoryViewTsx).toContain('saveHomeMemoryLlmConfig');
    expect(homeMemoryViewTsx).toContain('startHomeMemoryLlmStream');
    expect(homeMemoryViewTsx).toContain('className="llm-config-grid"');
    expect(homeMemoryViewTsx).toContain('className="llm-stream-log"');
    expect(styles).toContain('.llm-config-grid');
    expect(styles).toContain('.llm-stream-log');
  });

  it('renders event state ledger with presenter narration and state changes', () => {
    expect(homeMemoryViewTsx).toContain('StateLedgerPanel');
    expect(homeMemoryViewTsx).toContain('className="memory-panel state-ledger-panel"');
    expect(homeMemoryViewTsx).toContain('copy.stateLedger.narration');
    expect(homeMemoryViewTsx).toContain('copy.stateLedger.formula');
    expect(homeMemoryViewTsx).toContain('copy.stateLedger.changes');
    expect(styles).toContain('.state-ledger-panel');
    expect(styles).toContain('.state-ledger-narration');
    expect(styles).toContain('.state-ledger-change-row');
  });
});
