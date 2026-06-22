import React from 'react';
import { Line, OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { HomeMemoryGraphModel, HomeMemoryGraphNode, HomeMemoryGraphNodeKind } from './homeMemoryGraphModel';

interface HomeMemory3DProps {
  graph: HomeMemoryGraphModel;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

const NODE_COLORS: Record<HomeMemoryGraphNodeKind, string> = {
  home: '#20343b',
  room: '#267e71',
  device: '#2f6f9f',
  field: '#8a6f2a',
  hypothesis: '#9b4d4d'
};

export function HomeMemory3D({ graph, selectedNodeId, onSelectNode }: HomeMemory3DProps): React.ReactElement {
  const nodeById = React.useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes]
  );

  return (
    <Canvas
      camera={{ position: [0, 13, 21], fov: 46 }}
      className="memory-graph-canvas"
      dpr={[1, 1.7]}
      onPointerMissed={() => onSelectNode(null)}
    >
      <color attach="background" args={['#edf4f2']} />
      <ambientLight intensity={0.72} />
      <directionalLight position={[5, 9, 7]} intensity={1.35} />
      <hemisphereLight args={['#f8fbff', '#9fb3ad', 0.58]} />
      <group rotation={[-0.12, -0.28, 0]}>
        {graph.edges.map((edge) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);

          if (!from || !to) {
            return null;
          }

          return (
            <Line
              key={edge.id}
              points={[toVector(from), toVector(to)]}
              color={edgeColor(edge.kind)}
              lineWidth={edge.kind === 'supports' ? 1.2 : 0.9}
              transparent
              opacity={Math.max(0.2, Math.min(0.72, 0.22 + edge.strength / 8))}
            />
          );
        })}
        {graph.nodes.map((node) => (
          <MemoryNode
            key={node.id}
            node={node}
            selected={node.id === selectedNodeId}
            related={selectedNodeId ? node.relatedIds.includes(selectedNodeId) : false}
            onSelect={() => onSelectNode(node.id)}
          />
        ))}
      </group>
      <OrbitControls
        enableDamping
        enablePan
        maxDistance={34}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={8}
        minPolarAngle={Math.PI / 5}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}

function MemoryNode({
  node,
  selected,
  related,
  onSelect
}: {
  node: HomeMemoryGraphNode;
  selected: boolean;
  related: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const groupRef = React.useRef<THREE.Group>(null);
  const color = NODE_COLORS[node.kind];
  const radius = nodeRadius(node);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const pulse = selected ? 1 + Math.sin(clock.elapsedTime * 4.2) * 0.08 : 1;
    groupRef.current.scale.setScalar(pulse);
  });

  function handleClick(event: ThreeEvent<MouseEvent>): void {
    event.stopPropagation();
    onSelect();
  }

  return (
    <group ref={groupRef} position={toVector(node)}>
      <mesh onClick={handleClick} castShadow>
        <sphereGeometry args={[radius, 32, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.34 : related ? 0.16 : 0.05}
          roughness={0.62}
        />
      </mesh>
      {selected || related ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 1.28, radius * 1.72, 42]} />
          <meshBasicMaterial color={color} transparent opacity={selected ? 0.38 : 0.2} />
        </mesh>
      ) : null}
      <Text
        anchorX="center"
        anchorY="middle"
        color="#17202a"
        fontSize={labelSize(node.kind)}
        maxWidth={node.kind === 'hypothesis' ? 3.8 : 2.5}
        outlineColor="#f7fbfb"
        outlineWidth={0.025}
        position={[0, radius + 0.34, 0]}
      >
        {node.label}
      </Text>
    </group>
  );
}

function toVector(node: HomeMemoryGraphNode): [number, number, number] {
  return [node.x * 0.42, node.z * 0.82, node.y * 0.42];
}

function nodeRadius(node: HomeMemoryGraphNode): number {
  const activityBoost = Math.min(0.22, Math.max(0, node.activity) * 0.012);
  if (node.kind === 'home') return 0.52 + activityBoost;
  if (node.kind === 'hypothesis') return 0.32 + activityBoost;
  if (node.kind === 'field') return 0.22 + activityBoost;
  return 0.28 + activityBoost;
}

function labelSize(kind: HomeMemoryGraphNodeKind): number {
  if (kind === 'home') return 0.28;
  if (kind === 'hypothesis') return 0.2;
  return 0.18;
}

function edgeColor(kind: string): string {
  if (kind === 'supports') return '#9b4d4d';
  if (kind === 'observes') return '#8a6f2a';
  if (kind === 'co-occurs') return '#2f6f9f';
  return '#697b78';
}
