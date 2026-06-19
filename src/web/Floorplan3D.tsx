import React from 'react';
import { Html, Line, OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Bell, CircuitBoard, RotateCcw, Thermometer, Users } from 'lucide-react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { RoomId } from '../shared/types';
import { fixtureLayouts, type FixtureLayout } from './floorplanLayout';
import type { Floorplan3DDevice, Floorplan3DModel, Floorplan3DPerson, Floorplan3DRoom, FloorplanAutomationLink } from './floorplan3dModel';

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

interface Floorplan3DProps {
  model: Floorplan3DModel;
  layers: FloorplanLayers;
  selected: FloorplanSelection;
  onToggleLayer: (layer: keyof FloorplanLayers) => void;
  onSelect: (selection: FloorplanSelection) => void;
}

export function Floorplan3D({ model, layers, selected, onToggleLayer, onSelect }: Floorplan3DProps): React.ReactElement {
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
        <FloorplanScene model={model} layers={layers} selected={selected} onSelect={onSelect} />
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

function FloorplanScene({ model, layers, selected, onSelect }: Omit<Floorplan3DProps, 'onToggleLayer'>): React.ReactElement {
  const visibleDevices = model.devices.filter((device) => device.active || device.abnormal || selected?.type === 'device' && selected.id === device.id);

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
  const outlineColor = selected ? '#1e6fbb' : alert ? '#bc2f2f' : room.occupied ? '#267e71' : '#516166';

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
      <mesh position={[room.x, 0.065, room.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.min(room.width, room.depth) * 0.05, Math.max(room.width, room.depth) * 0.54, 4]} />
        <meshBasicMaterial color={outlineColor} transparent opacity={selected ? 0.11 : room.occupied ? 0.06 : 0.025} />
      </mesh>
      <Wall x={room.x} z={room.z - room.depth / 2} width={room.width} depth={room.wallThickness} height={room.wallHeight} color={outlineColor} />
      <Wall x={room.x} z={room.z + room.depth / 2} width={room.width} depth={room.wallThickness} height={room.wallHeight} color={outlineColor} />
      <Wall x={room.x - room.width / 2} z={room.z} width={room.wallThickness} depth={room.depth} height={room.wallHeight} color={outlineColor} />
      <Wall x={room.x + room.width / 2} z={room.z} width={room.wallThickness} depth={room.depth} height={room.wallHeight} color={outlineColor} />
      {room.id !== 'garden' ? <DoorHint room={room} color={selected ? '#d7eef4' : '#e7efed'} /> : null}
      {room.lit ? (
        <pointLight position={[room.x, 0.75, room.z]} intensity={0.55} distance={2.8} color="#ffdca0" />
      ) : null}
      {alert ? <AlertPulse room={room} color={outlineColor} /> : null}
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

function Wall({ x, z, width, depth, height, color }: { x: number; z: number; width: number; depth: number; height: number; color: string }): React.ReactElement {
  return (
    <mesh position={[x, height / 2 + 0.08, z]} castShadow receiveShadow>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color={color} roughness={0.7} metalness={0.03} />
    </mesh>
  );
}

function DoorHint({ room, color }: { room: Floorplan3DRoom; color: string }): React.ReactElement {
  const horizontal = room.width >= room.depth;
  const width = horizontal ? 0.55 : room.wallThickness + 0.02;
  const depth = horizontal ? room.wallThickness + 0.02 : 0.55;
  const x = horizontal ? room.x - room.width * 0.22 : room.x - room.width / 2;
  const z = horizontal ? room.z + room.depth / 2 : room.z - room.depth * 0.12;

  return (
    <mesh position={[x, 0.18, z]}>
      <boxGeometry args={[width, 0.36, depth]} />
      <meshStandardMaterial color={color} roughness={0.55} transparent opacity={0.9} />
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

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const path = person.movementPath;
    const bob = Math.sin(clock.elapsedTime * 2.4 + person.id.length) * 0.025;
    if (person.recent && path.length >= 2) {
      const progress = Math.min((clock.elapsedTime % 2.2) / 1.6, 1);
      const eased = easeInOutCubic(progress);
      const from = path[0];
      const to = path[path.length - 1];
      groupRef.current.position.set(lerp(from.x, to.x, eased), 0.42 + bob, lerp(from.z, to.z, eased));
    } else {
      groupRef.current.position.y = 0.42 + bob;
    }
  });

  return (
    <group ref={groupRef} position={[person.x, 0.42, person.z]}>
      {person.recent && person.movementPath.length >= 2 ? (
        <Line
          points={person.movementPath.map((point) => [point.x - person.x, -0.29, point.z - person.z] as [number, number, number])}
          color="#185a89"
          lineWidth={1.3}
          transparent
          opacity={0.36}
        />
      ) : null}
      <mesh castShadow>
        <sphereGeometry args={[0.13, 24, 24]} />
        <meshStandardMaterial color={person.id === 'pet_1' ? '#9a6a35' : '#185a89'} emissive={person.recent ? '#185a89' : '#000000'} emissiveIntensity={person.recent ? 0.25 : 0} />
      </mesh>
      <Html center position={[0, 0.28, 0]}>
        <span className={`person-label ${person.recent ? 'recent' : ''}`} title={person.activity}>{person.label}</span>
      </Html>
    </group>
  );
}

function DeviceMarker({ device, selected, onSelect }: { device: Floorplan3DDevice; selected: boolean; onSelect: () => void }): React.ReactElement {
  const color = getDeviceColor(device);
  const groupRef = React.useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const pulse = device.animationHint === 'pulse' || device.abnormal
      ? Math.sin(clock.elapsedTime * 3.5) * 0.045
      : 0;
    const vibe = device.animationHint === 'vibrate'
      ? Math.sin(clock.elapsedTime * 28) * 0.012
      : 0;
    const patrol = device.animationHint === 'patrol'
      ? Math.sin(clock.elapsedTime * 1.1) * 0.18
      : 0;
    groupRef.current.position.set(device.x + patrol + vibe, device.y + pulse, device.z + vibe);
    if (device.animationHint === 'rotate') {
      groupRef.current.rotation.y = clock.elapsedTime * 1.6;
    }
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
    <group ref={groupRef} position={[device.x, device.y, device.z]}>
      <DeviceGeometry device={device} color={color} selected={selected} onClick={handleClick} />
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, selected ? 0.34 : 0.28, 28]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.45 : 0.26} />
      </mesh>
      {device.animationHint === 'airflow' ? <Airflow color={color} /> : null}
      {device.animationHint === 'scan' ? <ScanCone color={color} /> : null}
      {device.animationHint === 'glow' ? <pointLight position={[0, 0.25, 0]} intensity={0.42} distance={1.7} color={color} /> : null}
      <Html center position={[0, 0.34, 0]}>
        <button className={`device-label kind-${device.markerKind} anim-${device.animationHint} ${device.abnormal ? 'alert' : ''}`} title={`${device.label} in ${device.roomId.replaceAll('_', ' ')} - ${device.statusLabel}`} onClick={handleDomClick}>
          {device.label}
        </button>
      </Html>
    </group>
  );
}

function DeviceGeometry({
  device,
  color,
  selected,
  onClick
}: {
  device: Floorplan3DDevice;
  color: string;
  selected: boolean;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}): React.ReactElement {
  const scale = selected ? 1.18 : 1;
  const material = <meshStandardMaterial color={color} emissive={color} emissiveIntensity={device.active || device.abnormal ? 0.28 : 0.08} roughness={0.46} metalness={0.12} />;

  if (device.markerKind === 'appliance') {
    return (
      <mesh scale={scale} onClick={onClick} castShadow>
        <boxGeometry args={[0.24, 0.22, 0.18]} />
        {material}
      </mesh>
    );
  }
  if (device.markerKind === 'mobile') {
    return (
      <mesh scale={scale} onClick={onClick} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.14, 0.08, 32]} />
        {material}
      </mesh>
    );
  }
  if (device.markerKind === 'security') {
    return (
      <mesh scale={scale} onClick={onClick} rotation={[0, 0, Math.PI / 2]} castShadow>
        <coneGeometry args={[0.13, 0.26, 24]} />
        {material}
      </mesh>
    );
  }
  if (device.markerKind === 'actuator') {
    return (
      <mesh scale={scale} onClick={onClick} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 0.2, 6]} />
        {material}
      </mesh>
    );
  }

  return (
    <mesh scale={scale} onClick={onClick} castShadow>
      <sphereGeometry args={[0.13, 24, 24]} />
      {material}
    </mesh>
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

function getDeviceColor(device: Floorplan3DDevice): string {
  if (device.abnormal) return '#bc2f2f';
  if (device.markerKind === 'sensor') return '#2b7c93';
  if (device.markerKind === 'actuator') return '#1f8a64';
  if (device.markerKind === 'appliance') return '#5c6f7d';
  if (device.markerKind === 'security') return '#7e5aa6';
  if (device.markerKind === 'lighting') return '#c9962a';
  if (device.markerKind === 'climate') return '#2a7ba8';
  if (device.markerKind === 'mobile') return '#386f55';
  if (device.markerKind === 'network') return '#3763a0';
  return '#1f8a64';
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
