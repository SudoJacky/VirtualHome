import React from 'react';
import { Html, Line, OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Bell, CircuitBoard, RotateCcw, Thermometer, Users } from 'lucide-react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { RoomId } from '../shared/types';
import { DeviceGeometry, getDeviceVisualColor, type DeviceActivityTreatment } from './deviceVisuals/DeviceGeometry';
import { fixtureLayouts, roomConnectionOpenings, wallSegments, type FixtureLayout, type RoomConnectionOpening, type WallSegment } from './floorplanLayout';
import { selectVisibleFloorplanDevices, type Floorplan3DDevice, type Floorplan3DModel, type Floorplan3DPerson, type Floorplan3DRoom, type FloorplanAutomationLink, type FloorplanDeviceDisplayMode, type PersonVisualStyle } from './floorplan3dModel';

export interface FloorplanLayers {
  people: boolean;
  devices: boolean;
  environment: boolean;
  alerts: boolean;
}

export type FloorplanSelection =
  | { type: 'room'; id: RoomId }
  | { type: 'device'; id: string }
  | null;

export interface CameraAutoFrameState {
  focusKey: string;
  autoFrame: boolean;
}

type CameraAutoFrameEvent =
  | { type: 'manual-control-started' }
  | { type: 'focus-target-changed'; focusKey: string }
  | { type: 'reset-view' };

export function createCameraAutoFrameState(focusKey: string): CameraAutoFrameState {
  return { focusKey, autoFrame: true };
}

export function updateCameraAutoFrameState(
  state: CameraAutoFrameState,
  event: CameraAutoFrameEvent
): CameraAutoFrameState {
  if (event.type === 'manual-control-started') {
    return { ...state, autoFrame: false };
  }
  if (event.type === 'reset-view') {
    return { ...state, autoFrame: true };
  }
  if (event.focusKey === state.focusKey) {
    return state;
  }
  return { focusKey: event.focusKey, autoFrame: true };
}

export interface RoomVisualTreatment {
  borderColor: string;
  wallColor: string;
  doorColor: string;
  floorAccentOpacity: number;
}

export function getDeviceActivityTreatment({
  active,
  abnormal,
  selected,
  replayFocused
}: {
  active: boolean;
  abnormal: boolean;
  selected: boolean;
  replayFocused: boolean;
}): DeviceActivityTreatment {
  const focusBoost = replayFocused ? 0.24 : selected ? 0.18 : 0;
  return {
    scaleMultiplier: 1 + focusBoost,
    ringOuterRadius: replayFocused ? 0.42 : selected ? 0.34 : 0.28,
    ringOpacity: replayFocused ? 0.62 : selected ? 0.45 : 0.26,
    emissiveIntensity: abnormal ? 0.46 : active ? 0.28 : replayFocused ? 0.2 : 0.08,
    pulseStrength: replayFocused ? 0.07 : abnormal ? 0.045 : 0
  };
}

export function getRoomVisualTreatment({
  selected,
  occupied,
  alertSeverity
}: {
  selected: boolean;
  occupied: boolean;
  alertSeverity: Floorplan3DRoom['alertSeverity'] | undefined;
}): RoomVisualTreatment {
  if (alertSeverity) {
    return {
      borderColor: '#bc2f2f',
      wallColor: '#8f3434',
      doorColor: '#f0ded8',
      floorAccentOpacity: 0.18
    };
  }
  if (selected) {
    return {
      borderColor: '#2f756d',
      wallColor: '#516166',
      doorColor: '#eef7f3',
      floorAccentOpacity: 0
    };
  }
  if (occupied) {
    return {
      borderColor: '#267e71',
      wallColor: '#516166',
      doorColor: '#e7efed',
      floorAccentOpacity: 0.035
    };
  }
  return {
    borderColor: '#516166',
    wallColor: '#516166',
    doorColor: '#e7efed',
    floorAccentOpacity: 0
  };
}

export interface DeviceHoverPreview {
  title: string;
  details: string[];
}

export function formatDeviceHoverPreview(device: Floorplan3DDevice): DeviceHoverPreview {
  return {
    title: device.displayName,
    details: [
      `Room: ${device.roomId.replaceAll('_', ' ')}`,
      `Status: ${device.statusLabel}`,
      device.recentEventLabel ? `Recent: ${device.recentEventLabel}` : 'Recent: no recent device event',
      device.interactionHint
    ]
  };
}

interface Floorplan3DProps {
  model: Floorplan3DModel;
  layers: FloorplanLayers;
  selected: FloorplanSelection;
  deviceDisplayMode: FloorplanDeviceDisplayMode;
  replayFocusDeviceId?: string | null;
  onToggleLayer: (layer: keyof FloorplanLayers) => void;
  onSelect: (selection: FloorplanSelection) => void;
}

export function Floorplan3D({ model, layers, selected, deviceDisplayMode, replayFocusDeviceId = null, onToggleLayer, onSelect }: Floorplan3DProps): React.ReactElement {
  const controlsRef = React.useRef<OrbitControlsImpl | null>(null);
  const cameraAutoFrameRef = React.useRef(createCameraAutoFrameState('overview'));
  const handleManualCameraControl = React.useCallback(() => {
    cameraAutoFrameRef.current = updateCameraAutoFrameState(
      cameraAutoFrameRef.current,
      { type: 'manual-control-started' }
    );
  }, []);
  const handleResetView = React.useCallback(() => {
    cameraAutoFrameRef.current = updateCameraAutoFrameState(cameraAutoFrameRef.current, { type: 'reset-view' });
    controlsRef.current?.reset();
  }, []);

  return (
    <div className="floorplan3d-shell">
      <div className="floorplan3d-toolbar" aria-label="Floorplan layers">
        <LayerButton active={layers.people} label="People" icon={<Users size={14} />} onClick={() => onToggleLayer('people')} />
        <LayerButton active={layers.devices} label="Devices" icon={<CircuitBoard size={14} />} onClick={() => onToggleLayer('devices')} />
        <LayerButton active={layers.environment} label="Environment" icon={<Thermometer size={14} />} onClick={() => onToggleLayer('environment')} />
        <LayerButton active={layers.alerts} label="Alerts" icon={<Bell size={14} />} onClick={() => onToggleLayer('alerts')} />
        <button className="icon-button" title="Reset view" onClick={handleResetView}>
          <RotateCcw size={15} />
        </button>
      </div>

      <Canvas
        camera={{ position: [0, 7.2, 7.4], fov: 42 }}
        className="floorplan3d-canvas"
        dpr={[1, 1.7]}
        shadows
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={['#edf4f2']} />
        <SceneLighting model={model} />
        <FloorplanScene model={model} layers={layers} selected={selected} deviceDisplayMode={deviceDisplayMode} replayFocusDeviceId={replayFocusDeviceId} onSelect={onSelect} />
        <CameraController
          model={model}
          selected={selected}
          controlsRef={controlsRef}
          cameraAutoFrameRef={cameraAutoFrameRef}
        />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          enablePan
          maxDistance={13}
          maxPolarAngle={Math.PI / 2.7}
          minDistance={5}
          minPolarAngle={Math.PI / 4.4}
          onStart={handleManualCameraControl}
          target={[0, 0, -0.3]}
        />
      </Canvas>

      <div className="floorplan3d-legend" aria-label="Floorplan status legend">
        <span><i className="legend-dot person" /> occupant</span>
        <span><i className="legend-dot device" /> active device</span>
        <span><i className="legend-dot alert" /> alert</span>
      </div>
    </div>
  );
}

function FloorplanScene({ model, layers, selected, deviceDisplayMode, replayFocusDeviceId, onSelect }: Omit<Floorplan3DProps, 'onToggleLayer'>): React.ReactElement {
  const visibleDevices = selectVisibleFloorplanDevices(model.devices, deviceDisplayMode, selected, replayFocusDeviceId ?? null);

  return (
    <group rotation={[0, -0.18, 0]}>
      <mesh position={[0, -0.08, 0.1]} receiveShadow>
        <boxGeometry args={[11.2, 0.08, 8.4]} />
        <meshStandardMaterial color="#ceddd8" roughness={0.92} metalness={0.02} />
      </mesh>
      <mesh position={[0, -0.025, 0.1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[11.8, 8.9]} />
        <meshStandardMaterial color="#dfe9e5" roughness={0.96} transparent opacity={0.42} />
      </mesh>
      <HomeShell />

      {model.rooms.map((room) => (
        <RoomMesh
          key={room.id}
          room={room}
          selected={selected?.type === 'room' && selected.id === room.id}
          showAlerts={layers.alerts}
          showEnvironment={layers.environment}
          onSelect={() => onSelect({ type: 'room', id: room.id })}
        />
      ))}

      {fixtureLayouts.map((fixture) => (
        <FixtureMesh key={fixture.id} fixture={fixture} />
      ))}

      {layers.alerts ? model.automationLinks.map((link) => (
        <AutomationPath key={link.id} link={link} devices={model.devices} />
      )) : null}

      {layers.people ? model.people.map((person) => (
        <PersonMarker key={person.id} person={person} />
      )) : null}

      {layers.devices ? visibleDevices.map((device) => (
        <DeviceMarker
          key={device.id}
          device={device}
          selected={selected?.type === 'device' && selected.id === device.id}
          replayFocused={replayFocusDeviceId === device.id}
          onSelect={() => onSelect({ type: 'device', id: device.id })}
        />
      )) : null}
    </group>
  );
}

function RoomMesh({
  room,
  selected,
  showAlerts,
  showEnvironment,
  onSelect
}: {
  room: Floorplan3DRoom;
  selected: boolean;
  showAlerts: boolean;
  showEnvironment: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const alert = showAlerts && room.alertSeverity;
  const material = getRoomMaterial(room);
  const floorColor = alert ? getAlertColor(room.alertSeverity) : room.lit ? material.litColor : room.floorColor;
  const treatment = getRoomVisualTreatment({
    selected,
    occupied: room.occupied,
    alertSeverity: alert ? room.alertSeverity : undefined
  });

  function handleClick(event: ThreeEvent<MouseEvent>): void {
    event.stopPropagation();
    onSelect();
  }

  function handleDomClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onSelect();
  }

  return (
    <group>
      <mesh position={[room.x, 0.02, room.z]} onClick={handleClick} receiveShadow>
        <boxGeometry args={[room.width, 0.08, room.depth]} />
        <meshStandardMaterial color={floorColor} roughness={material.roughness} metalness={material.metalness} />
      </mesh>
      {treatment.floorAccentOpacity > 0 ? (
        <mesh position={[room.x, 0.066, room.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.min(room.width, room.depth) * 0.12, Math.max(room.width, room.depth) * 0.5, 4]} />
          <meshBasicMaterial color={treatment.borderColor} transparent opacity={treatment.floorAccentOpacity} />
        </mesh>
      ) : null}
      <RoomPerimeterLine room={room} color={treatment.borderColor} selected={selected} alert={Boolean(alert)} />
      {room.lit ? (
        <pointLight position={[room.x, 0.75, room.z]} intensity={0.55} distance={2.8} color="#ffdca0" />
      ) : null}
      {alert ? <AlertPulse room={room} color={treatment.borderColor} /> : null}
      <Text
        anchorX="left"
        anchorY="middle"
        color="#17202a"
        fontSize={0.16}
        maxWidth={room.width - 0.25}
        position={[room.x - room.width / 2 + 0.18, 0.18, room.z - room.depth / 2 + 0.22]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        {room.label}
      </Text>
      {showEnvironment || alert ? (
        <Html center position={[room.x + room.width / 2 - 0.55, 0.34, room.z - room.depth / 2 + 0.3]}>
          <button className={`room-chip ${alert ? 'alert' : ''}`} title={`${room.label} climate`} onClick={handleDomClick}>
            {room.temperatureC.toFixed(1)}C / {room.humidityPercent.toFixed(0)}%
          </button>
        </Html>
      ) : null}
      {selected || alert ? (
        <Html center position={[room.x, 0.48, room.z + room.depth / 2 - 0.35]}>
          <button className={`room-status-card ${alert ? 'alert' : ''}`} title={`${room.label} status`} onClick={handleDomClick}>
            <span>Occ {room.occupied ? 'Yes' : 'No'}</span>
            <span>Comfort {room.temperatureC.toFixed(0)}C</span>
            <span>Risk {room.alertSeverity ?? 'normal'}</span>
          </button>
        </Html>
      ) : null}
    </group>
  );
}

function RoomPerimeterLine({ room, color, selected, alert }: { room: Floorplan3DRoom; color: string; selected: boolean; alert: boolean }): React.ReactElement {
  const y = selected || alert ? 0.145 : 0.11;
  const left = room.x - room.width / 2 + 0.05;
  const right = room.x + room.width / 2 - 0.05;
  const front = room.z - room.depth / 2 + 0.05;
  const back = room.z + room.depth / 2 - 0.05;
  const points: [number, number, number][] = [
    [left, y, front],
    [right, y, front],
    [right, y, back],
    [left, y, back],
    [left, y, front]
  ];

  return (
    <Line
      points={points}
      color={color}
      lineWidth={selected || alert ? 1.9 : 0.7}
      transparent
      opacity={selected || alert ? 0.86 : room.occupied ? 0.38 : 0.16}
    />
  );
}

function HomeShell(): React.ReactElement {
  return (
    <group>
      {wallSegments.map((segment) => (
        <HomeWall key={segment.id} segment={segment} />
      ))}
      {roomConnectionOpenings.map((opening) => (
        <OpeningThreshold key={opening.id} opening={opening} />
      ))}
    </group>
  );
}

function HomeWall({ segment }: { segment: WallSegment }): React.ReactElement {
  const color = segment.kind === 'exterior' ? '#40555b' : '#697b78';
  return (
    <Wall
      x={segment.x}
      z={segment.z}
      width={segment.width}
      depth={segment.depth}
      height={segment.height}
      color={color}
    />
  );
}

function OpeningThreshold({ opening }: { opening: RoomConnectionOpening }): React.ReactElement {
  const color = opening.kind === 'wide-opening' ? '#b8cfc8' : opening.kind === 'open-plan' ? '#c6d8d2' : '#d6dfdc';
  return (
    <mesh position={[opening.x, 0.105, opening.z]} receiveShadow>
      <boxGeometry args={[opening.width, 0.035, opening.depth]} />
      <meshStandardMaterial color={color} roughness={0.68} metalness={0.02} />
    </mesh>
  );
}

function Wall({ x, z, width, depth, height, color }: { x: number; z: number; width: number; depth: number; height: number; color: string }): React.ReactElement {
  return (
    <mesh position={[x, height / 2 + 0.08, z]} castShadow receiveShadow>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color={color} roughness={0.7} metalness={0.03} />
    </mesh>
  );
}

function AlertPulse({ room, color }: { room: Floorplan3DRoom; color: string }): React.ReactElement {
  const ref = React.useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const pulse = 1 + Math.sin(clock.elapsedTime * 3.2) * 0.04;
    if (ref.current) {
      ref.current.scale.set(pulse, pulse, pulse);
    }
  });

  return (
    <mesh ref={ref} position={[room.x, 0.09, room.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[Math.min(room.width, room.depth) * 0.46, Math.max(room.width, room.depth) * 0.56, 64]} />
      <meshBasicMaterial color={color} transparent opacity={0.32} />
    </mesh>
  );
}

function FixtureMesh({ fixture }: { fixture: FixtureLayout }): React.ReactElement {
  const material = getFixtureMaterial(fixture.kind);
  const height = fixture.height ?? (fixture.kind === 'plant' ? 0.42 : fixture.kind === 'wardrobe' || fixture.kind === 'bookcase' ? 0.55 : 0.18);
  const y = height / 2 + 0.08;

  if (fixture.kind === 'bed') return <BedFixture fixture={fixture} materialColor={material.color} />;
  if (fixture.kind === 'sofa') return <SofaFixture fixture={fixture} materialColor={material.color} />;
  if (fixture.kind === 'table' || fixture.kind === 'desk') return <TableFixture fixture={fixture} materialColor={material.color} />;
  if (fixture.kind === 'plant') return <PlantFixture fixture={fixture} />;
  if (fixture.kind === 'tub') return <TubFixture fixture={fixture} />;

  return (
    <mesh position={[fixture.x, y, fixture.z]} rotation={[0, fixture.rotation ?? 0, 0]} castShadow receiveShadow>
      <boxGeometry args={[fixture.width, height, fixture.depth]} />
      <meshStandardMaterial color={material.color} roughness={material.roughness} />
    </mesh>
  );
}

function PersonMarker({ person }: { person: Floorplan3DPerson }): React.ReactElement {
  const groupRef = React.useRef<THREE.Group>(null);
  const movementKey = React.useMemo(
    () => person.movementSegments.length > 0
      ? person.movementSegments.map((segment) => `${segment.startedAt}:${segment.endedAt}:${segment.from.x.toFixed(2)},${segment.from.z.toFixed(2)}>${segment.to.x.toFixed(2)},${segment.to.z.toFixed(2)}`).join('|')
      : person.movementPath.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join('|'),
    [person.movementPath, person.movementSegments]
  );
  const animationRef = React.useRef({ key: '', startedAt: 0 });

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const path = person.movementPath;
    if (animationRef.current.key !== movementKey) {
      animationRef.current = { key: movementKey, startedAt: clock.elapsedTime };
    }
    const baseY = person.visualStyle.form === 'pet' ? 0.12 : 0.08;
    const activeSegment = person.movementSegments.find((segment) => segment.progress > 0 && segment.progress < 1) ?? person.movementSegments.at(-1);
    if (person.recent && activeSegment) {
      const segmentProgress = activeSegment.progress > 0 && activeSegment.progress < 1
        ? activeSegment.progress
        : Math.min((clock.elapsedTime - animationRef.current.startedAt) / Math.max(0.6, activeSegment.travelMinutes || 0.6), 1);
      const eased = easeInOutCubic(segmentProgress);
      groupRef.current.position.set(lerp(activeSegment.from.x, activeSegment.to.x, eased), baseY, lerp(activeSegment.from.z, activeSegment.to.z, eased));
    } else if (person.recent && path.length >= 2) {
      const progress = Math.min((clock.elapsedTime - animationRef.current.startedAt) / 1.25, 1);
      const eased = easeInOutCubic(progress);
      const from = path[0];
      const to = path[path.length - 1];
      groupRef.current.position.set(lerp(from.x, to.x, eased), baseY, lerp(from.z, to.z, eased));
    } else {
      groupRef.current.position.set(person.x, baseY, person.z);
    }
  });

  return (
    <group ref={groupRef} position={[person.x, person.visualStyle.form === 'pet' ? 0.12 : 0.08, person.z]}>
      {person.movementTrailVisible && person.recent && person.movementSegments.length > 0 ? (
        <Line
          points={person.movementSegments.flatMap((segment) => [
            [segment.from.x - person.x, -0.29, segment.from.z - person.z] as [number, number, number],
            [segment.to.x - person.x, -0.29, segment.to.z - person.z] as [number, number, number]
          ])}
          color="#185a89"
          lineWidth={1.3}
          transparent
          opacity={0.36}
        />
      ) : person.movementTrailVisible && person.recent && person.movementPath.length >= 2 ? (
        <Line
          points={person.movementPath.map((point) => [point.x - person.x, -0.29, point.z - person.z] as [number, number, number])}
          color="#185a89"
          lineWidth={1.3}
          transparent
          opacity={0.36}
        />
      ) : null}
      {person.visualStyle.form === 'pet'
        ? <PetFigure style={person.visualStyle} recent={person.recent} />
        : <HumanFigure style={person.visualStyle} recent={person.recent} />}
      <Html center position={[0, person.visualStyle.height + 0.1, 0]}>
        <span className={`person-label ${person.recent ? 'recent' : ''}`} title={person.activity}>{person.label}</span>
      </Html>
    </group>
  );
}

function HumanFigure({ style, recent }: { style: PersonVisualStyle; recent: boolean }): React.ReactElement {
  const scale = style.height / 0.76;
  const emissiveIntensity = recent ? 0.18 : 0;

  return (
    <group scale={[scale, scale, scale]}>
      <mesh position={[0, 0.61, 0]} castShadow>
        <sphereGeometry args={[0.105, 24, 24]} />
        <meshStandardMaterial color={style.skinColor} roughness={0.62} />
      </mesh>
      <mesh position={[0, 0.42, 0]} castShadow>
        <cylinderGeometry args={[style.width * 0.34, style.width * 0.48, 0.32, 18]} />
        <meshStandardMaterial color={style.bodyColor} emissive={style.bodyColor} emissiveIntensity={emissiveIntensity} roughness={0.58} />
      </mesh>
      <mesh position={[0, 0.52, 0]} castShadow>
        <boxGeometry args={[style.width * 1.1, 0.055, 0.08]} />
        <meshStandardMaterial color={style.accentColor} roughness={0.6} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`arm-${side}`} position={[side * style.width * 0.62, 0.38, 0]} rotation={[0, 0, side * 0.32]} castShadow>
          <cylinderGeometry args={[0.026, 0.026, 0.27, 12]} />
          <meshStandardMaterial color={style.bodyColor} roughness={0.6} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`leg-${side}`} position={[side * style.width * 0.18, 0.18, 0]} castShadow>
          <cylinderGeometry args={[0.033, 0.036, 0.32, 12]} />
          <meshStandardMaterial color="#313f44" roughness={0.68} />
        </mesh>
      ))}
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[style.width * 0.58, 24]} />
        <meshBasicMaterial color={style.bodyColor} transparent opacity={recent ? 0.22 : 0.12} />
      </mesh>
    </group>
  );
}

function PetFigure({ style, recent }: { style: PersonVisualStyle; recent: boolean }): React.ReactElement {
  return (
    <group>
      <mesh position={[0, 0.18, 0]} scale={[style.width * 1.15, style.height * 0.72, style.width * 0.72]} castShadow>
        <sphereGeometry args={[0.5, 24, 18]} />
        <meshStandardMaterial color={style.bodyColor} emissive={style.bodyColor} emissiveIntensity={recent ? 0.12 : 0} roughness={0.78} />
      </mesh>
      <mesh position={[style.width * 0.48, 0.23, 0]} scale={[style.width * 0.58, style.height * 0.5, style.width * 0.46]} castShadow>
        <sphereGeometry args={[0.5, 20, 16]} />
        <meshStandardMaterial color={style.accentColor} roughness={0.72} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`ear-${side}`} position={[style.width * 0.56, 0.36, side * style.width * 0.13]} rotation={[0, 0, -0.35]} castShadow>
          <coneGeometry args={[0.045, 0.12, 12]} />
          <meshStandardMaterial color={style.accentColor} roughness={0.72} />
        </mesh>
      ))}
      {[-1, 1].flatMap((x) => [-1, 1].map((z) => (
        <mesh key={`${x}-${z}`} position={[x * style.width * 0.18, 0.065, z * style.width * 0.22]} castShadow>
          <cylinderGeometry args={[0.025, 0.026, 0.12, 10]} />
          <meshStandardMaterial color={style.accentColor} roughness={0.7} />
        </mesh>
      )))}
      <mesh position={[-style.width * 0.48, 0.23, 0]} rotation={[0, 0, 0.85]} castShadow>
        <cylinderGeometry args={[0.018, 0.025, 0.24, 10]} />
        <meshStandardMaterial color={style.accentColor} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[style.width * 0.62, 24]} />
        <meshBasicMaterial color={style.bodyColor} transparent opacity={recent ? 0.2 : 0.1} />
      </mesh>
    </group>
  );
}

function DeviceMarker({ device, selected, replayFocused, onSelect }: { device: Floorplan3DDevice; selected: boolean; replayFocused: boolean; onSelect: () => void }): React.ReactElement {
  const color = getDeviceVisualColor(device);
  const groupRef = React.useRef<THREE.Group>(null);
  const [hovered, setHovered] = React.useState(false);
  const hoverPreview = formatDeviceHoverPreview(device);
  const treatment = getDeviceActivityTreatment({
    active: device.active,
    abnormal: device.abnormal,
    selected,
    replayFocused
  });

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const animated = device.active || device.abnormal || replayFocused;
    const vibe = device.animationHint === 'vibrate' && animated
      ? Math.sin(clock.elapsedTime * 28) * 0.012
      : 0;
    const patrol = device.animationHint === 'patrol' && animated
      ? Math.sin(clock.elapsedTime * 1.1) * 0.18
      : 0;
    groupRef.current.position.set(device.x + patrol + vibe, device.y, device.z + vibe);
    groupRef.current.rotation.y = device.rotation + (device.animationHint === 'rotate' ? clock.elapsedTime * 1.6 : 0);
  });

  function handleClick(event: ThreeEvent<MouseEvent>): void {
    event.stopPropagation();
    onSelect();
  }

  function handlePointerOver(event: ThreeEvent<PointerEvent>): void {
    event.stopPropagation();
    setHovered(true);
  }

  function handlePointerOut(event: ThreeEvent<PointerEvent>): void {
    event.stopPropagation();
    setHovered(false);
  }

  function handleDomClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onSelect();
  }

  return (
    <group ref={groupRef} position={[device.x, device.y, device.z]} rotation={[0, device.rotation, 0]} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
      <DeviceGeometry device={device} color={color} treatment={treatment} onClick={handleClick} />
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, treatment.ringOuterRadius, 28]} />
        <meshBasicMaterial color={color} transparent opacity={treatment.ringOpacity} />
      </mesh>
      {device.animationHint === 'airflow' ? <Airflow color={color} /> : null}
      {device.animationHint === 'waterflow' ? <Waterflow active={device.active || device.abnormal} /> : null}
      {device.animationHint === 'open_close' ? <OpenCloseSweep color={color} active={device.active || device.abnormal} /> : null}
      {device.animationHint === 'scan' ? <ScanCone color={color} /> : null}
      {device.animationHint === 'glow' ? <pointLight position={[0, 0.25, 0]} intensity={0.42} distance={1.7} color={color} /> : null}
      <Html center position={[0, 0.34, 0]}>
        <button
          className={`device-label kind-${device.markerKind} anim-${device.animationHint} operability-${device.operability} ${device.abnormal ? 'alert' : ''} ${replayFocused ? 'replay-focus' : ''}`}
          title={[hoverPreview.title, ...hoverPreview.details].join(' - ')}
          onClick={handleDomClick}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
        >
          {device.label}
        </button>
      </Html>
      {hovered ? (
        <Html center position={[0, 0.68, 0]}>
          <div className="device-hover-preview" role="tooltip">
            <strong>{hoverPreview.title}</strong>
            {hoverPreview.details.map((detail) => <span key={detail}>{detail}</span>)}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function AutomationPath({ link, devices }: { link: FloorplanAutomationLink; devices: Floorplan3DDevice[] }): React.ReactElement | null {
  const source = devices.find((device) => device.id === link.sourceDeviceId);
  const target = devices.find((device) => device.id === link.targetDeviceId);
  if (!source || !target) return null;

  const color = link.severity === 'critical' ? '#bc2f2f' : link.severity === 'warning' ? '#b48320' : '#1f8a64';
  const points: [number, number, number][] = [
    [source.x, source.y + 0.1, source.z],
    [(source.x + target.x) / 2, Math.max(source.y, target.y) + 0.4, (source.z + target.z) / 2],
    [target.x, target.y + 0.1, target.z]
  ];

  return (
    <group>
      <Line points={points} color={color} lineWidth={2.2} transparent opacity={0.72} />
      <mesh position={points[0]}>
        <sphereGeometry args={[0.055, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={points[2]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function Airflow({ color }: { color: string }): React.ReactElement {
  return (
    <group position={[0.14, 0.02, 0]}>
      {[0, 1, 2].map((index) => (
        <Line
          key={index}
          points={[[0, index * 0.035, -0.12], [0.22, index * 0.035 + 0.02, 0.02], [0.36, index * 0.035, 0.14]]}
          color={color}
          lineWidth={0.8}
          transparent
          opacity={0.42}
        />
      ))}
    </group>
  );
}

function Waterflow({ active }: { active: boolean }): React.ReactElement {
  const opacity = active ? 0.68 : 0.32;
  return (
    <group position={[0.02, 0.03, 0]}>
      {[0, 1, 2].map((index) => (
        <Line
          key={index}
          points={[
            [-0.18, index * 0.025, -0.1],
            [-0.02, index * 0.025 + 0.035, 0],
            [0.18, index * 0.025, 0.1]
          ]}
          color="#2a7ba8"
          lineWidth={active ? 1.2 : 0.75}
          transparent
          opacity={opacity}
        />
      ))}
      {active ? (
        <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.08, 0.26, 28]} />
          <meshBasicMaterial color="#2a7ba8" transparent opacity={0.2} />
        </mesh>
      ) : null}
    </group>
  );
}

function OpenCloseSweep({ color, active }: { color: string; active: boolean }): React.ReactElement {
  return (
    <group position={[0, 0.02, 0]}>
      <Line
        points={[
          [-0.2, 0, -0.16],
          [-0.08, 0.035, -0.02],
          [0.06, 0.045, 0.12],
          [0.2, 0, 0.18]
        ]}
        color={color}
        lineWidth={active ? 1.25 : 0.8}
        transparent
        opacity={active ? 0.58 : 0.28}
      />
      <mesh position={[0.19, 0, 0.18]}>
        <sphereGeometry args={[0.025, 10, 10]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 0.72 : 0.36} />
      </mesh>
    </group>
  );
}

function ScanCone({ color }: { color: string }): React.ReactElement {
  return (
    <mesh position={[0.18, -0.02, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 5]}>
      <circleGeometry args={[0.36, 24, 0, Math.PI / 3]} />
      <meshBasicMaterial color={color} transparent opacity={0.16} side={THREE.DoubleSide} />
    </mesh>
  );
}

function SceneLighting({ model }: { model: Floorplan3DModel }): React.ReactElement {
  const mode = model.rooms.some((room) => room.lit) ? 'warm' : 'balanced';
  return (
    <>
      <hemisphereLight args={['#f6fbff', '#9eb4ad', mode === 'warm' ? 1.05 : 0.86]} />
      <ambientLight intensity={0.48} />
      <directionalLight
        castShadow
        position={[3.2, 7.2, 4.6]}
        intensity={1.65}
        shadow-mapSize={[1024, 1024]}
      />
    </>
  );
}

function CameraController({
  model,
  selected,
  controlsRef,
  cameraAutoFrameRef
}: {
  model: Floorplan3DModel;
  selected: FloorplanSelection;
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  cameraAutoFrameRef: React.MutableRefObject<CameraAutoFrameState>;
}): null {
  const { camera } = useThree();
  const targetRef = React.useRef(new THREE.Vector3(0, 0, -0.3));
  const positionRef = React.useRef(new THREE.Vector3(0, 7.2, 7.4));

  React.useEffect(() => {
    cameraAutoFrameRef.current = updateCameraAutoFrameState(cameraAutoFrameRef.current, {
      type: 'focus-target-changed',
      focusKey: getCameraFocusKey(selected)
    });
    const focus = getFocusPoint(model, selected);
    targetRef.current.set(focus.x, 0, focus.z);
    positionRef.current.set(focus.x + 2.4, selected ? 4.6 : 7.2, focus.z + (selected ? 3.2 : 7.4));
  }, [cameraAutoFrameRef, model, selected]);

  useFrame(() => {
    if (!cameraAutoFrameRef.current.autoFrame) {
      return;
    }
    camera.position.lerp(positionRef.current, 0.045);
    controlsRef.current?.target.lerp(targetRef.current, 0.06);
    controlsRef.current?.update();
  });

  return null;
}

function getCameraFocusKey(selected: FloorplanSelection): string {
  if (selected?.type === 'room') return `room:${selected.id}`;
  if (selected?.type === 'device') return `device:${selected.id}`;
  return 'overview';
}

function getFocusPoint(model: Floorplan3DModel, selected: FloorplanSelection): { x: number; z: number } {
  if (selected?.type === 'room') {
    const room = model.rooms.find((candidate) => candidate.id === selected.id);
    if (room) return { x: room.x, z: room.z };
  }
  if (selected?.type === 'device') {
    const device = model.devices.find((candidate) => candidate.id === selected.id);
    if (device) return { x: device.x, z: device.z };
  }
  const link = model.automationLinks[0];
  const target = model.devices.find((device) => device.id === link?.targetDeviceId);
  if (target) return { x: target.x, z: target.z };
  return { x: 0, z: -0.3 };
}

function BedFixture({ fixture, materialColor }: { fixture: FixtureLayout; materialColor: string }): React.ReactElement {
  return (
    <group position={[fixture.x, 0.17, fixture.z]} rotation={[0, fixture.rotation ?? 0, 0]}>
      <Box size={[fixture.width, 0.18, fixture.depth]} color={materialColor} />
      <Box position={[-fixture.width * 0.25, 0.11, -fixture.depth * 0.28]} size={[fixture.width * 0.32, 0.08, fixture.depth * 0.22]} color="#f0eee7" />
      <Box position={[fixture.width * 0.18, 0.12, 0.05]} size={[fixture.width * 0.48, 0.05, fixture.depth * 0.62]} color="#d8c7bc" />
    </group>
  );
}

function SofaFixture({ fixture, materialColor }: { fixture: FixtureLayout; materialColor: string }): React.ReactElement {
  return (
    <group position={[fixture.x, 0.18, fixture.z]} rotation={[0, fixture.rotation ?? 0, 0]}>
      <Box size={[fixture.width, 0.16, fixture.depth]} color={materialColor} />
      <Box position={[0, 0.12, -fixture.depth * 0.42]} size={[fixture.width, 0.24, 0.12]} color="#a99c8c" />
      <Box position={[-fixture.width * 0.47, 0.08, 0]} size={[0.12, 0.2, fixture.depth]} color="#a99c8c" />
      <Box position={[fixture.width * 0.47, 0.08, 0]} size={[0.12, 0.2, fixture.depth]} color="#a99c8c" />
    </group>
  );
}

function TableFixture({ fixture, materialColor }: { fixture: FixtureLayout; materialColor: string }): React.ReactElement {
  const legX = fixture.width * 0.38;
  const legZ = fixture.depth * 0.32;
  return (
    <group position={[fixture.x, 0.18, fixture.z]} rotation={[0, fixture.rotation ?? 0, 0]}>
      <Box position={[0, 0.08, 0]} size={[fixture.width, 0.08, fixture.depth]} color={materialColor} />
      {[-1, 1].flatMap((x) => [-1, 1].map((z) => (
        <Box key={`${x}-${z}`} position={[x * legX, -0.02, z * legZ]} size={[0.05, 0.18, 0.05]} color="#7d7668" />
      )))}
    </group>
  );
}

function PlantFixture({ fixture }: { fixture: FixtureLayout }): React.ReactElement {
  return (
    <group position={[fixture.x, 0.18, fixture.z]}>
      <Box position={[0, -0.02, 0]} size={[fixture.width * 0.44, 0.16, fixture.depth * 0.44]} color="#7f8d78" />
      <mesh position={[0, 0.16, 0]} castShadow>
        <sphereGeometry args={[fixture.width * 0.42, 18, 18]} />
        <meshStandardMaterial color="#6aa779" roughness={0.82} />
      </mesh>
    </group>
  );
}

function TubFixture({ fixture }: { fixture: FixtureLayout }): React.ReactElement {
  return (
    <group position={[fixture.x, 0.17, fixture.z]} rotation={[0, fixture.rotation ?? 0, 0]}>
      <Box size={[fixture.width, 0.18, fixture.depth]} color="#b7c5c7" />
      <Box position={[0, 0.08, 0]} size={[fixture.width * 0.75, 0.04, fixture.depth * 0.58]} color="#e4eeee" />
    </group>
  );
}

function Box({
  position = [0, 0, 0],
  size,
  color
}: {
  position?: [number, number, number];
  size: [number, number, number];
  color: string;
}): React.ReactElement {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.76} />
    </mesh>
  );
}

function LayerButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button className={`layer-button ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}>
      {icon}
      {label}
    </button>
  );
}

function getAlertColor(severity: Floorplan3DRoom['alertSeverity']): string {
  if (severity === 'critical') return '#f2c4bf';
  if (severity === 'warning') return '#f4ddb2';
  return '#d9e8f4';
}

function getRoomMaterial(room: Floorplan3DRoom): { litColor: string; roughness: number; metalness: number } {
  if (room.materialKind === 'tile') return { litColor: '#f3e6c2', roughness: 0.5, metalness: 0.02 };
  if (room.materialKind === 'grass') return { litColor: '#d7e8bd', roughness: 0.92, metalness: 0 };
  if (room.materialKind === 'carpet') return { litColor: '#f0d9ba', roughness: 0.96, metalness: 0 };
  if (room.materialKind === 'stone') return { litColor: '#eadbb9', roughness: 0.72, metalness: 0.03 };
  return { litColor: '#f2dfb0', roughness: 0.78, metalness: 0.01 };
}

function getFixtureMaterial(kind: FixtureLayout['kind']): { color: string; roughness: number } {
  if (kind === 'plant') return { color: '#6aa779', roughness: 0.72 };
  if (kind === 'counter' || kind === 'tub') return { color: '#b7c5c7', roughness: 0.62 };
  if (kind === 'bed' || kind === 'sofa') return { color: '#b9a996', roughness: 0.82 };
  return { color: '#b9b39f', roughness: 0.76 };
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
