import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDeviceVisualProfile } from '../src/web/deviceVisualRegistry';
import { getDeviceVisualColor } from '../src/web/deviceVisuals/DeviceGeometry';
import { formatDeviceHoverPreview } from '../src/web/Floorplan3D';
import type { Floorplan3DDevice } from '../src/web/floorplan3dModel';

describe('device visual renderer', () => {
  it('keeps concrete device geometry outside the floorplan scene shell', () => {
    const floorplanScene = readFileSync(path.resolve('src/web/Floorplan3D.tsx'), 'utf8');
    const renderer = readFileSync(path.resolve('src/web/deviceVisuals/DeviceGeometry.tsx'), 'utf8');

    expect(floorplanScene).toContain("from './deviceVisuals/DeviceGeometry'");
    expect(floorplanScene).not.toContain('function DeviceVisualBody');
    expect(floorplanScene).not.toContain('function DeviceVisualAccentMesh');
    expect(renderer).toContain('export function DeviceGeometry');
    expect(renderer).toContain('getDeviceVisualProfile');
  });

  it('keeps fallback visual profiles renderable by the extracted renderer', () => {
    expect(getDeviceVisualProfile('generic_box')).toMatchObject({
      bodyShape: 'box',
      accent: 'indicator'
    });
    expect(getDeviceVisualProfile('generic_sphere')).toMatchObject({
      bodyShape: 'sphere',
      accent: 'indicator'
    });
  });

  it('derives device visual colors from device state and marker kind', () => {
    expect(getDeviceVisualColor(device({ markerKind: 'sensor' }))).toBe('#2b7c93');
    expect(getDeviceVisualColor(device({ markerKind: 'security' }))).toBe('#7e5aa6');
    expect(getDeviceVisualColor(device({ markerKind: 'appliance', abnormal: true }))).toBe('#bc2f2f');
  });

  it('formats hover previews with status, recent event, and interaction guidance', () => {
    expect(formatDeviceHoverPreview(device({
      displayName: 'Home Router',
      roomId: 'study',
      statusLabel: 'offline',
      recentEventLabel: 'abnormality network offline',
      interactionHint: 'Device is offline; controls are disabled until connectivity recovers.'
    }))).toEqual({
      title: 'Home Router',
      details: [
        'Room: study',
        'Status: offline',
        'Recent: abnormality network offline',
        'Device is offline; controls are disabled until connectivity recovers.'
      ]
    });
  });
});

function device(overrides: Partial<Floorplan3DDevice>): Floorplan3DDevice {
  return {
    id: 'device_01',
    roomId: 'living_room',
    label: 'Device',
    displayName: 'Device',
    instanceGroup: 'living_comfort',
    privacyLevel: 'household',
    riskLevel: 'normal',
    x: 0,
    z: 0,
    y: 0.12,
    mount: 'floor',
    rotation: 0,
    scale: 1,
    markerKind: 'sensor',
    visualModel: 'generic_box',
    visualVariant: null,
    statusLabel: 'idle',
    active: false,
    abnormal: false,
    animationHint: 'none',
    commandStatus: 'none',
    commandReason: null,
    recentEventLabel: null,
    healthStatus: [],
    operability: 'read_only',
    interactionHint: 'Read-only device',
    ...overrides
  };
}
