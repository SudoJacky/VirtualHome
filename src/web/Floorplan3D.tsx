import React from 'react';
import { Html, OrbitControls, Text } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Bell, CircuitBoard, RotateCcw, Thermometer, Users } from 'lucide-react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { RoomId } from '../shared/types';
import { fixtureLayouts, type FixtureLayout } from './floorplanLayout';
import type { Floorplan3DDevice, Floorplan3DModel, Floorplan3DPerson, Floorplan3DRoom } from './floorplan3dModel';

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

interface Floorplan3DProps {
  model: Floorplan3DModel;
  layers: FloorplanLayers;
  selected: FloorplanSelection;
  onToggleLayer: (layer: keyof FloorplanLayers) => void;
  onSelect: (selection: FloorplanSelection) => void;
}

export function Floorplan3D({ model, layers, selected, onToggleLayer, onSelect }: Floorplan3DProps): React.ReactElement {
  const controlsRef = React.useRef<OrbitControlsImpl | null>(null);

  return (
    <div className="floorplan3d-shell">
      <div className="floorplan3d-toolbar" aria-label="Floorplan layers">
        <LayerButton active={layers.people} label="People" icon={<Users size={14} />} onClick={() => onToggleLayer('people')} />
        <LayerButton active={layers.devices} label="Devices" icon={<CircuitBoard size={14} />} onClick={() => onToggleLayer('devices')} />
        <LayerButton active={layers.environment} label="Environment" icon={<Thermometer size={14} />} onClick={() => onToggleLayer('environment')} />
        <LayerButton active={layers.alerts} label="Alerts" icon={<Bell size={14} />} onClick={() => onToggleLayer('alerts')} />
        <button className="icon-button" title="Reset view" onClick={() => controlsRef.current?.reset()}>
          <RotateCcw size={15} />
        </button>
      </div>

      <Canvas
        camera={{ position: [0, 7.2, 7.4], fov: 42 }}
        className="floorplan3d-canvas"
        dpr={[1, 1.7]}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={['#eef5f4']} />
        <ambientLight intensity={1.65} />
        <directionalLight position={[2.5, 6, 3]} intensity={1.6} />
        <FloorplanScene model={model} layers={layers} selected={selected} onSelect={onSelect} />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          enablePan
          maxDistance={13}
          maxPolarAngle={Math.PI / 2.7}
          minDistance={5}
          minPolarAngle={Math.PI / 4.4}
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
  return (
    <group rotation={[0, -0.18, 0]}>
      <mesh position={[0, -0.05, 0.1]} receiveShadow>
        <boxGeometry args={[11.2, 0.08, 8.4]} />
        <meshStandardMaterial color="#cfe0dc" roughness={0.9} />
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

      {layers.people ? model.people.map((person) => (
        <PersonMarker key={person.id} person={person} />
      )) : null}

      {layers.devices ? model.devices.filter((device) => device.active || device.abnormal).map((device) => (
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
  const floorColor = alert ? getAlertColor(room.alertSeverity) : room.lit ? '#f4dfaa' : room.floorColor;
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
      <mesh position={[room.x, 0.02, room.z]} onClick={handleClick}>
        <boxGeometry args={[room.width, 0.08, room.depth]} />
        <meshStandardMaterial color={floorColor} roughness={0.82} />
      </mesh>
      <Wall x={room.x} z={room.z - room.depth / 2} width={room.width} depth={0.08} color={outlineColor} />
      <Wall x={room.x} z={room.z + room.depth / 2} width={room.width} depth={0.08} color={outlineColor} />
      <Wall x={room.x - room.width / 2} z={room.z} width={0.08} depth={room.depth} color={outlineColor} />
      <Wall x={room.x + room.width / 2} z={room.z} width={0.08} depth={room.depth} color={outlineColor} />
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
          <button className={`room-chip ${alert ? 'alert' : ''}`} onClick={handleDomClick}>
            {room.temperatureC.toFixed(1)}C / {room.humidityPercent.toFixed(0)}%
          </button>
        </Html>
      ) : null}
    </group>
  );
}

function Wall({ x, z, width, depth, color }: { x: number; z: number; width: number; depth: number; color: string }): React.ReactElement {
  return (
    <mesh position={[x, 0.18, z]}>
      <boxGeometry args={[width, 0.32, depth]} />
      <meshStandardMaterial color={color} roughness={0.78} />
    </mesh>
  );
}

function FixtureMesh({ fixture }: { fixture: FixtureLayout }): React.ReactElement {
  const material = getFixtureMaterial(fixture.kind);
  const height = fixture.kind === 'plant' ? 0.42 : fixture.kind === 'wardrobe' || fixture.kind === 'bookcase' ? 0.55 : 0.18;
  const y = height / 2 + 0.08;

  return (
    <mesh position={[fixture.x, y, fixture.z]} rotation={[0, fixture.rotation ?? 0, 0]}>
      <boxGeometry args={[fixture.width, height, fixture.depth]} />
      <meshStandardMaterial color={material.color} roughness={material.roughness} />
    </mesh>
  );
}

function PersonMarker({ person }: { person: Floorplan3DPerson }): React.ReactElement {
  return (
    <group position={[person.x, 0.42, person.z]}>
      <mesh>
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
  const color = device.abnormal ? '#bc2f2f' : '#1f8a64';

  function handleClick(event: ThreeEvent<MouseEvent>): void {
    event.stopPropagation();
    onSelect();
  }

  function handleDomClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onSelect();
  }

  return (
    <group position={[device.x, device.y, device.z]}>
      <mesh onClick={handleClick}>
        <sphereGeometry args={[selected ? 0.17 : 0.13, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, selected ? 0.34 : 0.28, 28]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.45 : 0.26} />
      </mesh>
      <Html center position={[0, 0.34, 0]}>
        <button className={`device-label ${device.abnormal ? 'alert' : ''}`} onClick={handleDomClick}>
          {device.label}
        </button>
      </Html>
    </group>
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

function getFixtureMaterial(kind: FixtureLayout['kind']): { color: string; roughness: number } {
  if (kind === 'plant') return { color: '#6aa779', roughness: 0.72 };
  if (kind === 'counter' || kind === 'tub') return { color: '#b7c5c7', roughness: 0.62 };
  if (kind === 'bed' || kind === 'sofa') return { color: '#b9a996', roughness: 0.82 };
  return { color: '#b9b39f', roughness: 0.76 };
}
