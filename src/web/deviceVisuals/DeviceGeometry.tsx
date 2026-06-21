import React from 'react';
import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { getDeviceVisualProfile, type DeviceVisualAccent, type DeviceVisualProfile } from '../deviceVisualRegistry';
import type { Floorplan3DDevice } from '../floorplan3dModel';

export interface DeviceActivityTreatment {
  scaleMultiplier: number;
  ringOuterRadius: number;
  ringOpacity: number;
  emissiveIntensity: number;
  pulseStrength: number;
}

export function DeviceGeometry({
  device,
  color,
  treatment,
  onClick
}: {
  device: Floorplan3DDevice;
  color: string;
  treatment: DeviceActivityTreatment;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}): React.ReactElement {
  const visual = getDeviceVisualProfile(device.visualModel, device.visualVariant);
  const scale = treatment.scaleMultiplier * device.scale;
  const material = (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={treatment.emissiveIntensity}
      roughness={0.46}
      metalness={0.12}
    />
  );

  return (
    <group scale={[scale, scale, scale]}>
      <DeviceVisualBody visual={visual} material={material} onClick={onClick} />
      <DeviceVisualAccentMesh visual={visual} accent={visual.accent} color={color} />
    </group>
  );
}

export function getDeviceVisualColor(device: Floorplan3DDevice): string {
  if (device.abnormal) return '#bc2f2f';
  if (device.markerKind === 'sensor') return '#2b7c93';
  if (device.markerKind === 'actuator') return '#1f8a64';
  if (device.markerKind === 'appliance') return '#5c6f7d';
  if (device.markerKind === 'security') return '#7e5aa6';
  if (device.markerKind === 'lighting') return '#c9962a';
  if (device.markerKind === 'climate') return '#2a7ba8';
  if (device.markerKind === 'media') return '#5c517d';
  if (device.markerKind === 'mobile') return '#386f55';
  if (device.markerKind === 'network') return '#3763a0';
  return '#1f8a64';
}

function DeviceVisualBody({
  visual,
  material,
  onClick
}: {
  visual: DeviceVisualProfile;
  material: React.ReactElement;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}): React.ReactElement {
  const [width, height, depth] = visual.bodySize;

  if (visual.bodyShape === 'box') {
    return (
      <mesh onClick={onClick} castShadow receiveShadow>
        <boxGeometry args={visual.bodySize} />
        {material}
      </mesh>
    );
  }
  if (visual.bodyShape === 'cylinder') {
    return (
      <mesh onClick={onClick} castShadow receiveShadow>
        <cylinderGeometry args={[width / 2, depth / 2, height, 32]} />
        {material}
      </mesh>
    );
  }
  if (visual.bodyShape === 'cone') {
    return (
      <mesh onClick={onClick} rotation={visual.wallOriented ? [0, 0, Math.PI / 2] : [0, 0, 0]} castShadow receiveShadow>
        <coneGeometry args={[width / 2, height, 24]} />
        {material}
      </mesh>
    );
  }

  return (
    <mesh onClick={onClick} castShadow receiveShadow>
      <sphereGeometry args={[Math.max(width, height, depth) / 2, 24, 24]} />
      {material}
    </mesh>
  );
}

function DeviceVisualAccentMesh({
  visual,
  accent,
  color
}: {
  visual: DeviceVisualProfile;
  accent: DeviceVisualAccent;
  color: string;
}): React.ReactElement | null {
  const [width, height, depth] = visual.bodySize;
  const frontZ = -depth / 2 - 0.007;
  const accentColor = '#edf4f2';
  const darkColor = '#17202a';

  if (accent === 'screen') {
    return <VisualBox position={[0, 0, frontZ]} size={[width * 0.8, height * 0.68, 0.012]} color={darkColor} />;
  }
  if (accent === 'door') {
    return (
      <group>
        <VisualBox position={[0, 0, frontZ]} size={[0.012, height * 0.82, 0.012]} color={accentColor} />
        <VisualBox position={[width * 0.28, 0, frontZ - 0.004]} size={[0.018, height * 0.38, 0.014]} color={accentColor} />
      </group>
    );
  }
  if (accent === 'round_door') {
    return (
      <mesh position={[0, 0, frontZ]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[Math.min(width, height) * 0.28, Math.min(width, height) * 0.28, 0.018, 32]} />
        <meshStandardMaterial color={accentColor} roughness={0.5} metalness={0.08} />
      </mesh>
    );
  }
  if (accent === 'antennas') {
    return (
      <group>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * width * 0.28, height * 0.75, 0]} rotation={[0, 0, side * 0.25]} castShadow>
            <cylinderGeometry args={[0.008, 0.008, height * 1.35, 8]} />
            <meshStandardMaterial color={darkColor} roughness={0.42} />
          </mesh>
        ))}
      </group>
    );
  }
  if (accent === 'lens') {
    return (
      <mesh position={[height * 0.42, 0, 0]} castShadow>
        <sphereGeometry args={[width * 0.18, 20, 16]} />
        <meshStandardMaterial color={darkColor} emissive={color} emissiveIntensity={0.18} roughness={0.34} metalness={0.15} />
      </mesh>
    );
  }
  if (accent === 'top_disc') {
    return (
      <mesh position={[0, height / 2 + 0.01, 0]} castShadow>
        <cylinderGeometry args={[Math.min(width, depth) * 0.28, Math.min(width, depth) * 0.28, 0.018, 28]} />
        <meshStandardMaterial color={accentColor} emissive={color} emissiveIntensity={0.12} roughness={0.48} />
      </mesh>
    );
  }
  if (accent === 'handle') {
    return <VisualBox position={[width * 0.35, 0, frontZ]} size={[0.024, height * 0.45, 0.018]} color={accentColor} />;
  }
  if (accent === 'spray_head') {
    return (
      <mesh position={[0, height / 2 + 0.035, 0]} castShadow>
        <coneGeometry args={[width * 0.32, height * 0.58, 16]} />
        <meshStandardMaterial color={accentColor} emissive={color} emissiveIntensity={0.12} roughness={0.52} />
      </mesh>
    );
  }
  if (accent === 'pipe') {
    return <VisualBox position={[0, 0, 0]} size={[width * 1.6, height * 0.16, depth * 0.35]} color={accentColor} />;
  }
  if (accent === 'probe') {
    return (
      <mesh position={[0, -height * 0.65, 0]} castShadow>
        <coneGeometry args={[width * 0.26, height * 0.72, 12]} />
        <meshStandardMaterial color={darkColor} roughness={0.62} />
      </mesh>
    );
  }
  if (accent === 'curtain') {
    return (
      <group>
        {[-0.25, 0, 0.25].map((offset) => (
          <VisualBox key={offset} position={[offset * width, 0, frontZ]} size={[width * 0.12, height * 0.9, 0.012]} color={accentColor} />
        ))}
      </group>
    );
  }
  if (accent === 'airflow') {
    return (
      <group position={[width * 0.54, -height * 0.12, 0]}>
        {[0, 1, 2].map((index) => (
          <Line
            key={index}
            points={[[0, index * height * 0.18, -depth * 0.35], [width * 0.28, index * height * 0.18, 0], [width * 0.45, index * height * 0.18, depth * 0.35]]}
            color={color}
            lineWidth={0.7}
            transparent
            opacity={0.42}
          />
        ))}
      </group>
    );
  }
  if (accent === 'dish_rack') {
    return (
      <group>
        {[-0.25, 0, 0.25].map((offset) => (
          <VisualBox key={offset} position={[offset * width, -height * 0.05, frontZ]} size={[0.012, height * 0.42, 0.012]} color={accentColor} />
        ))}
      </group>
    );
  }
  if (accent === 'indicator') {
    return (
      <mesh position={[width * 0.28, height * 0.24, frontZ]} castShadow>
        <sphereGeometry args={[Math.min(width, height, depth) * 0.13, 12, 12]} />
        <meshStandardMaterial color={accentColor} emissive={color} emissiveIntensity={0.18} roughness={0.44} />
      </mesh>
    );
  }

  return null;
}

function VisualBox({
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
      <meshStandardMaterial color={color} roughness={0.56} />
    </mesh>
  );
}
