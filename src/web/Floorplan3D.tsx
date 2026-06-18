import React from 'react';
import { Html, OrbitControls, Text } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Bell, CircuitBoard, RotateCcw, Thermometer, Users } from 'lucide-react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { RoomId } from '../shared/types';
import { fixtureLayouts, type FixtureLayout, type RoomOpening, type WallSide } from './floorplanLayout';
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
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        onPointerMissed={() => onSelect(null)}
        shadows
      >
        <color attach="background" args={['#edf4f2']} />
        <SceneLighting rooms={model.rooms} />
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
  const hasRoomSelection = selected?.type === 'room';
  return (
    <group rotation={[0, -0.18, 0]}>
      <mesh position={[0, -0.08, 0.1]} receiveShadow>
        <boxGeometry args={[11.2, 0.08, 8.4]} />
        <meshStandardMaterial color="#c9d8d5" roughness={0.94} />
      </mesh>
      <mesh position={[0, -0.02, 0.1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[11.3, 8.5]} />
        <meshStandardMaterial color="#dce8e5" roughness={0.96} transparent opacity={0.42} />
      </mesh>

      {model.rooms.map((room) => (
        <RoomMesh
          key={room.id}
          room={room}
          dimmed={hasRoomSelection && selected.id !== room.id}
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

      {layers.devices ? model.devices.map((device) => (
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
  dimmed,
  selected,
  showAlerts,
  showEnvironment,
  onSelect
}: {
  room: Floorplan3DRoom;
  dimmed: boolean;
  selected: boolean;
  showAlerts: boolean;
  showEnvironment: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const alert = showAlerts && room.alertSeverity;
  const floorColor = alert ? getAlertColor(room.alertSeverity) : room.lit ? blendColor(room.floorColor, '#f6dfa8', 0.38) : room.floorColor;
  const outlineColor = selected ? '#1e6fbb' : alert ? '#bc2f2f' : room.occupied ? '#267e71' : '#516166';
  const opacity = dimmed ? 0.48 : 1;
  const floorLift = selected ? 0.035 : 0.02;

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
      <mesh position={[room.x, floorLift, room.z]} onClick={handleClick} receiveShadow>
        <boxGeometry args={[room.width, 0.08, room.depth]} />
        <meshStandardMaterial
          color={floorColor}
          roughness={getFloorRoughness(room.floorMaterial)}
          transparent={dimmed}
          opacity={opacity}
        />
      </mesh>
      <FloorPattern room={room} dimmed={dimmed} />
      <Wall side="north" room={room} color={outlineColor} dimmed={dimmed} />
      <Wall side="south" room={room} color={outlineColor} dimmed={dimmed} />
      <Wall side="west" room={room} color={outlineColor} dimmed={dimmed} />
      <Wall side="east" room={room} color={outlineColor} dimmed={dimmed} />
      {selected ? (
        <mesh position={[room.x, 0.105, room.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(room.width, room.depth) * 0.48, Math.max(room.width, room.depth) * 0.52, 64]} />
          <meshBasicMaterial color="#2f86c8" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      ) : null}
      {room.lit ? (
        <pointLight color="#ffe0a5" distance={2.4} intensity={0.8} position={[room.x, 1.1, room.z]} />
      ) : null}
      <Text
        anchorX="left"
        anchorY="middle"
        color={dimmed ? '#6f7d82' : '#17202a'}
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
    </group>
  );
}

function Wall({ side, room, color, dimmed }: { side: WallSide; room: Floorplan3DRoom; color: string; dimmed: boolean }): React.ReactElement {
  const isHorizontal = side === 'north' || side === 'south';
  const x = side === 'west' ? room.x - room.width / 2 : side === 'east' ? room.x + room.width / 2 : room.x;
  const z = side === 'north' ? room.z - room.depth / 2 : side === 'south' ? room.z + room.depth / 2 : room.z;
  const width = isHorizontal ? room.width : room.wallThickness;
  const depth = isHorizontal ? room.wallThickness : room.depth;
  const openings = room.openings.filter((opening) => opening.side === side);
  return (
    <group>
      <mesh castShadow receiveShadow position={[x, room.wallHeight / 2 + 0.08, z]}>
        <boxGeometry args={[width, room.wallHeight, depth]} />
        <meshStandardMaterial color={color} roughness={0.72} transparent={dimmed} opacity={dimmed ? 0.42 : 0.9} />
      </mesh>
      {openings.map((opening) => (
        <OpeningMarker key={`${room.id}-${side}-${opening.offset}`} opening={opening} room={room} />
      ))}
    </group>
  );
}

function FixtureMesh({ fixture }: { fixture: FixtureLayout }): React.ReactElement {
  const material = getFixtureMaterial(fixture.kind);
  const height = fixture.height ?? (fixture.kind === 'plant' ? 0.42 : fixture.kind === 'wardrobe' || fixture.kind === 'bookcase' ? 0.55 : 0.18);
  const y = height / 2 + 0.08;

  return (
    <group position={[fixture.x, 0.08, fixture.z]} rotation={[0, fixture.rotation ?? 0, 0]}>
      <mesh castShadow receiveShadow position={[0, y - 0.08, 0]}>
        <boxGeometry args={[fixture.width, height, fixture.depth]} />
        <meshStandardMaterial color={material.color} roughness={material.roughness} />
      </mesh>
      <FixtureDetails fixture={fixture} baseHeight={height} />
    </group>
  );
}

function FixtureDetails({ fixture, baseHeight }: { fixture: FixtureLayout; baseHeight: number }): React.ReactElement | null {
  if (fixture.kind === 'sofa') {
    return (
      <>
        <DetailBox color="#8f8173" depth={0.09} height={0.24} width={fixture.width} x={0} y={baseHeight + 0.12} z={fixture.depth / 2 - 0.04} />
        <DetailBox color="#9e8f80" depth={fixture.depth} height={0.2} width={0.12} x={-fixture.width / 2 + 0.06} y={baseHeight + 0.02} z={0} />
        <DetailBox color="#9e8f80" depth={fixture.depth} height={0.2} width={0.12} x={fixture.width / 2 - 0.06} y={baseHeight + 0.02} z={0} />
      </>
    );
  }
  if (fixture.kind === 'bed') {
    return (
      <>
        <DetailBox color="#e6ddd4" depth={fixture.depth * 0.72} height={0.08} width={fixture.width * 0.9} x={0} y={baseHeight + 0.05} z={0.02} />
        <DetailBox color="#f3efe8" depth={fixture.depth * 0.22} height={0.09} width={fixture.width * 0.42} x={-fixture.width * 0.2} y={baseHeight + 0.12} z={-fixture.depth * 0.28} />
        <DetailBox color="#a8b4c5" depth={fixture.depth * 0.34} height={0.06} width={fixture.width * 0.8} x={0.05} y={baseHeight + 0.15} z={fixture.depth * 0.2} />
      </>
    );
  }
  if (fixture.kind === 'table' || fixture.kind === 'desk' || fixture.kind === 'counter') {
    const legColor = fixture.kind === 'counter' ? '#87989b' : '#8f816f';
    return (
      <>
        <DetailBox color={legColor} depth={0.06} height={0.18} width={0.06} x={-fixture.width / 2 + 0.08} y={-0.01} z={-fixture.depth / 2 + 0.08} />
        <DetailBox color={legColor} depth={0.06} height={0.18} width={0.06} x={fixture.width / 2 - 0.08} y={-0.01} z={-fixture.depth / 2 + 0.08} />
        <DetailBox color={legColor} depth={0.06} height={0.18} width={0.06} x={-fixture.width / 2 + 0.08} y={-0.01} z={fixture.depth / 2 - 0.08} />
        <DetailBox color={legColor} depth={0.06} height={0.18} width={0.06} x={fixture.width / 2 - 0.08} y={-0.01} z={fixture.depth / 2 - 0.08} />
      </>
    );
  }
  if (fixture.kind === 'plant') {
    return (
      <>
        <mesh castShadow position={[0, baseHeight + 0.1, 0]}>
          <sphereGeometry args={[Math.max(fixture.width, fixture.depth) * 0.42, 16, 12]} />
          <meshStandardMaterial color="#4f8d61" roughness={0.88} />
        </mesh>
        <mesh castShadow position={[0.08, baseHeight + 0.28, -0.05]}>
          <sphereGeometry args={[Math.max(fixture.width, fixture.depth) * 0.27, 16, 12]} />
          <meshStandardMaterial color="#6fa87a" roughness={0.86} />
        </mesh>
      </>
    );
  }
  if (fixture.kind === 'bookcase' || fixture.kind === 'wardrobe') {
    return <DetailBox color="#7f877f" depth={fixture.depth * 0.92} height={0.03} width={fixture.width * 1.04} x={0} y={baseHeight * 0.58} z={0} />;
  }
  return null;
}

function DetailBox({
  color,
  depth,
  height,
  width,
  x,
  y,
  z
}: {
  color: string;
  depth: number;
  height: number;
  width: number;
  x: number;
  y: number;
  z: number;
}): React.ReactElement {
  return (
    <mesh castShadow receiveShadow position={[x, y + height / 2, z]}>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color={color} roughness={0.82} />
    </mesh>
  );
}

function PersonMarker({ person }: { person: Floorplan3DPerson }): React.ReactElement {
  const color = person.id === 'pet_1' ? '#9a6a35' : '#185a89';
  return (
    <group position={[person.x, 0.42, person.z]}>
      <mesh castShadow position={[0, -0.08, 0]}>
        <capsuleGeometry args={[person.id === 'pet_1' ? 0.08 : 0.095, person.id === 'pet_1' ? 0.08 : 0.22, 8, 16]} />
        <meshStandardMaterial color={color} emissive={person.recent ? color : '#000000'} emissiveIntensity={person.recent ? 0.25 : 0} roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 0.1, 0]}>
        <sphereGeometry args={[person.id === 'pet_1' ? 0.075 : 0.085, 18, 18]} />
        <meshStandardMaterial color={color} roughness={0.68} />
      </mesh>
      <Html center position={[0, 0.28, 0]}>
        <span className={`person-label ${person.recent ? 'recent' : ''}`} title={person.activity}>{person.label}</span>
      </Html>
    </group>
  );
}

function DeviceMarker({ device, selected, onSelect }: { device: Floorplan3DDevice; selected: boolean; onSelect: () => void }): React.ReactElement {
  const color = device.abnormal ? '#bc2f2f' : '#1f8a64';
  const [hovered, setHovered] = React.useState(false);
  const labelVisible = selected || hovered || device.active || device.abnormal;
  const opacity = device.active || selected || device.abnormal ? 1 : 0.55;

  function handleClick(event: ThreeEvent<MouseEvent>): void {
    event.stopPropagation();
    onSelect();
  }

  function handleDomClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onSelect();
  }

  return (
    <group
      position={[device.x, device.y, device.z]}
      rotation={[0, device.orientation, 0]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <DeviceGeometry device={device} color={color} opacity={opacity} selected={selected} onClick={handleClick} />
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, selected ? 0.34 : 0.28, 28]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.5 : device.active ? 0.26 : 0.12} />
      </mesh>
      {device.animationHint === 'airflow' && device.active ? <AirflowHint color={color} /> : null}
      {device.markerKind === 'security' && device.active ? <SecurityScan color={color} /> : null}
      {labelVisible ? <Html center position={[0, 0.34, 0]}>
        <button className={`device-label ${device.abnormal ? 'alert' : ''}`} title={`${device.label} in ${device.roomId.replaceAll('_', ' ')}`} onClick={handleDomClick}>
          {device.label}
        </button>
      </Html> : null}
      {hovered ? (
        <Html center position={[0, 0.65, 0]}>
          <div className="floorplan-tooltip">
            <strong>{device.label}</strong>
            <span>{device.roomId.replaceAll('_', ' ')}</span>
            <span>{device.statusLabel}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function DeviceGeometry({
  color,
  device,
  opacity,
  onClick,
  selected
}: {
  color: string;
  device: Floorplan3DDevice;
  opacity: number;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
  selected: boolean;
}): React.ReactElement {
  const emissiveIntensity = device.active || selected ? 0.34 : 0.08;
  const material = (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={emissiveIntensity}
      roughness={0.62}
      transparent={opacity < 1}
      opacity={opacity}
    />
  );

  if (device.markerKind === 'sensor') {
    return (
      <>
        <mesh castShadow onClick={onClick}>
          <cylinderGeometry args={[selected ? 0.13 : 0.1, selected ? 0.15 : 0.12, 0.12, 24]} />
          {material}
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
          <ringGeometry args={[0.14, 0.19, 28]} />
          <meshBasicMaterial color={color} transparent opacity={device.active ? 0.36 : 0.18} />
        </mesh>
      </>
    );
  }

  if (device.markerKind === 'actuator') {
    return (
      <group>
        <mesh castShadow onClick={onClick}>
          <boxGeometry args={[selected ? 0.28 : 0.22, 0.16, selected ? 0.22 : 0.18]} />
          {material}
        </mesh>
        <mesh castShadow position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.07, 0.09, 0.1, 18]} />
          {material}
        </mesh>
      </group>
    );
  }

  if (device.markerKind === 'appliance') {
    return (
      <group>
        <mesh castShadow onClick={onClick}>
          <boxGeometry args={[selected ? 0.3 : 0.24, selected ? 0.3 : 0.24, 0.18]} />
          {material}
        </mesh>
        <mesh position={[0, 0.04, -0.092]}>
          <boxGeometry args={[0.14, 0.045, 0.012]} />
          <meshBasicMaterial color="#eaf5f1" transparent opacity={0.72} />
        </mesh>
      </group>
    );
  }

  if (device.markerKind === 'security') {
    return (
      <group>
        <mesh castShadow onClick={onClick}>
          <sphereGeometry args={[selected ? 0.15 : 0.12, 20, 16]} />
          {material}
        </mesh>
        <mesh castShadow position={[0, 0, -0.13]}>
          <coneGeometry args={[0.08, 0.18, 18]} />
          {material}
        </mesh>
      </group>
    );
  }

  return (
    <group>
      <mesh castShadow onClick={onClick} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[selected ? 0.18 : 0.15, selected ? 0.18 : 0.15, 0.08, 32]} />
        {material}
      </mesh>
      <mesh position={[0, 0.055, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.11, 0.012, 8, 24]} />
        <meshBasicMaterial color="#eaf5f1" transparent opacity={0.68} />
      </mesh>
    </group>
  );
}

function AirflowHint({ color }: { color: string }): React.ReactElement {
  return (
    <group position={[0, 0.02, -0.18]}>
      {[0, 1, 2].map((index) => (
        <mesh key={index} position={[(index - 1) * 0.08, 0.03, -index * 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.08 + index * 0.025, 0.006, 8, 28, Math.PI]} />
          <meshBasicMaterial color={color} transparent opacity={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function SecurityScan({ color }: { color: string }): React.ReactElement {
  return (
    <mesh position={[0, -0.01, -0.18]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.38, 32, -0.4, 0.8]} />
      <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
    </mesh>
  );
}

function SceneLighting({ rooms }: { rooms: Floorplan3DRoom[] }): React.ReactElement {
  const activeRooms = rooms.filter((room) => room.lit || room.alertSeverity || room.occupied).slice(0, 5);
  return (
    <>
      <hemisphereLight args={['#f5fbff', '#b8c7bd', 0.72]} />
      <ambientLight intensity={0.72} />
      <directionalLight
        castShadow
        intensity={1.45}
        position={[3.4, 7.2, 4.6]}
        shadow-camera-bottom={-6}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={6}
        shadow-mapSize-height={1024}
        shadow-mapSize-width={1024}
      />
      {activeRooms.map((room) => (
        <pointLight
          key={room.id}
          color={room.alertSeverity ? getAlertColor(room.alertSeverity) : room.lit ? '#ffdca1' : '#dbefff'}
          distance={room.alertSeverity ? 2.8 : 2.2}
          intensity={room.alertSeverity ? 0.72 : room.lit ? 0.52 : 0.24}
          position={[room.x, 1.05, room.z]}
        />
      ))}
    </>
  );
}

function FloorPattern({ room, dimmed }: { room: Floorplan3DRoom; dimmed: boolean }): React.ReactElement | null {
  const opacity = dimmed ? 0.08 : 0.16;
  if (room.floorMaterial === 'grass') {
    return (
      <group>
        {[-0.35, -0.1, 0.18, 0.42].map((offset, index) => (
          <mesh key={index} position={[room.x + room.width * offset, 0.071, room.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.035, room.depth * 0.86]} />
            <meshBasicMaterial color="#739a6c" transparent opacity={opacity} />
          </mesh>
        ))}
      </group>
    );
  }

  const horizontal = room.floorMaterial === 'tile' || room.floorMaterial === 'stone';
  const count = horizontal ? Math.max(2, Math.floor(room.depth / 0.45)) : Math.max(3, Math.floor(room.width / 0.5));
  return (
    <group>
      {Array.from({ length: count }).map((_, index) => {
        const ratio = (index + 1) / (count + 1);
        const x = horizontal ? room.x : room.x - room.width / 2 + room.width * ratio;
        const z = horizontal ? room.z - room.depth / 2 + room.depth * ratio : room.z;
        return (
          <mesh key={index} position={[x, 0.073, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={horizontal ? [room.width * 0.92, 0.015] : [0.015, room.depth * 0.92]} />
            <meshBasicMaterial color="#52666a" transparent opacity={opacity} />
          </mesh>
        );
      })}
    </group>
  );
}

function OpeningMarker({ opening, room }: { opening: RoomOpening; room: Floorplan3DRoom }): React.ReactElement {
  const isHorizontal = opening.side === 'north' || opening.side === 'south';
  const x = isHorizontal ? room.x + opening.offset : opening.side === 'west' ? room.x - room.width / 2 : room.x + room.width / 2;
  const z = isHorizontal ? opening.side === 'north' ? room.z - room.depth / 2 : room.z + room.depth / 2 : room.z + opening.offset;
  const y = opening.kind === 'window' ? room.wallHeight * 0.72 + 0.08 : room.wallHeight * 0.35 + 0.08;
  const width = isHorizontal ? opening.width : room.wallThickness + 0.025;
  const depth = isHorizontal ? room.wallThickness + 0.025 : opening.width;
  const height = opening.kind === 'window' ? room.wallHeight * 0.34 : room.wallHeight * 0.78;
  return (
    <mesh position={[x, y, z]}>
      <boxGeometry args={[width, height, depth]} />
      <meshBasicMaterial color={opening.kind === 'window' ? '#dceef1' : '#f4ede1'} transparent opacity={0.7} />
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

function getFloorRoughness(material: Floorplan3DRoom['floorMaterial']): number {
  if (material === 'tile' || material === 'stone') return 0.64;
  if (material === 'grass') return 0.98;
  if (material === 'soft') return 0.88;
  return 0.76;
}

function getFixtureMaterial(kind: FixtureLayout['kind']): { color: string; roughness: number } {
  if (kind === 'plant') return { color: '#6aa779', roughness: 0.72 };
  if (kind === 'counter' || kind === 'tub') return { color: '#b7c5c7', roughness: 0.62 };
  if (kind === 'bed' || kind === 'sofa') return { color: '#b9a996', roughness: 0.82 };
  return { color: '#b9b39f', roughness: 0.76 };
}

function blendColor(base: string, overlay: string, amount: number): string {
  const left = parseHexColor(base);
  const right = parseHexColor(overlay);
  const channel = (a: number, b: number) => Math.round(a + (b - a) * amount).toString(16).padStart(2, '0');
  return `#${channel(left.r, right.r)}${channel(left.g, right.g)}${channel(left.b, right.b)}`;
}

function parseHexColor(color: string): { r: number; g: number; b: number } {
  const value = color.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}
