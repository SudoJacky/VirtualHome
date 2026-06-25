import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dashboard layout density', () => {
  const mainTsx = readFileSync(path.resolve('src/web/main.tsx'), 'utf8');
  const floorplan3dTsx = readFileSync(path.resolve('src/web/Floorplan3D.tsx'), 'utf8');
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
    expect(homeMemoryViewTsx).toContain('aria-label="Memory graph view mode"');
    expect(homeMemoryViewTsx).toContain("setMemoryGraphMode('topology')");
    expect(homeMemoryViewTsx).toContain('memory-view-mode-toggle');
  });
});
