import React from 'react';
import { Line, OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { HomeMemoryGraphModel, HomeMemoryGraphNode, HomeMemoryGraphNodeKind } from './homeMemoryGraphModel';

interface HomeMemory3DProps {
  graph: HomeMemoryGraphModel;
  highlightedEdgeIds?: string[];
  highlightedNodeIds?: string[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

const NODE_COLORS: Record<HomeMemoryGraphNodeKind, string> = {
  home: '#20343b',
  room: '#267e71',
  device: '#2f6f9f',
  field: '#8a6f2a',
  semantic: '#7353a8',
  hypothesis: '#9b4d4d'
};

const HIGHLIGHT_COLOR = '#f0a92e';

export function HomeMemory3D({
  graph,
  highlightedEdgeIds = [],
  highlightedNodeIds = [],
  selectedNodeId,
  onSelectNode
}: HomeMemory3DProps): React.ReactElement {
  const nodeById = React.useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes]
  );
  const highlightedNodeIdSet = React.useMemo(() => new Set(highlightedNodeIds), [highlightedNodeIds]);
  const highlightedEdgeIdSet = React.useMemo(() => new Set(highlightedEdgeIds), [highlightedEdgeIds]);

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
        {graph.layers.map((layer) => (
          <MemoryLayerGuide key={layer.kind} kind={layer.kind} label={layer.label} radius={layer.radius} z={layer.z} />
        ))}
        {graph.edges.map((edge) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          const highlighted = highlightedEdgeIdSet.has(edge.id);

          if (!from || !to) {
            return null;
          }

          return (
            <React.Fragment key={edge.id}>
              <Line
                points={[toVector(from), toVector(to)]}
                color={highlighted ? HIGHLIGHT_COLOR : edgeColor(edge.kind)}
                lineWidth={highlighted ? 2.7 : edge.kind === 'supports' ? 1.2 : 0.9}
                transparent
                opacity={highlighted ? 0.96 : Math.max(0.2, Math.min(0.72, 0.22 + edge.strength / 8))}
              />
              {highlighted ? <FlowPulse from={from} to={to} seed={edge.id.length} /> : null}
            </React.Fragment>
          );
        })}
        {graph.nodes.map((node) => (
          <MemoryNode
            key={node.id}
            node={node}
            highlighted={highlightedNodeIdSet.has(node.id)}
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

function FlowPulse({
  from,
  to,
  seed
}: {
  from: HomeMemoryGraphNode;
  to: HomeMemoryGraphNode;
  seed: number;
}): React.ReactElement {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const start = React.useMemo(() => new THREE.Vector3(...toVector(from)), [from]);
  const end = React.useMemo(() => new THREE.Vector3(...toVector(to)), [to]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const progress = (clock.elapsedTime * 0.72 + seed * 0.07) % 1;
    meshRef.current.position.copy(start).lerp(end, progress);
    meshRef.current.scale.setScalar(0.82 + Math.sin(progress * Math.PI) * 0.34);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.09, 18, 14]} />
      <meshStandardMaterial
        color="#ffd27a"
        emissive="#f0a92e"
        emissiveIntensity={0.7}
        roughness={0.42}
      />
    </mesh>
  );
}

function MemoryLayerGuide({
  kind,
  label,
  radius,
  z
}: {
  kind: HomeMemoryGraphNodeKind;
  label: string;
  radius: number;
  z: number;
}): React.ReactElement | null {
  const scaledRadius = radius * 0.42;

  if (kind === 'home') {
    return (
      <Text
        anchorX="center"
        anchorY="middle"
        color="#4a5d5a"
        fontSize={0.18}
        outlineColor="#edf4f2"
        outlineWidth={0.018}
        position={[0, z * 0.82 - 0.42, 0.82]}
      >
        {label}
      </Text>
    );
  }

  return (
    <group position={[0, z * 0.82 - 0.02, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(0.1, scaledRadius - 0.025), scaledRadius + 0.025, 96]} />
        <meshBasicMaterial color={NODE_COLORS[kind]} transparent opacity={0.18} />
      </mesh>
      <Text
        anchorX="left"
        anchorY="middle"
        color={NODE_COLORS[kind]}
        fontSize={0.18}
        outlineColor="#edf4f2"
        outlineWidth={0.02}
        position={[scaledRadius + 0.42, 0.08, 0]}
      >
        {label}
      </Text>
    </group>
  );
}

function MemoryNode({
  node,
  highlighted,
  selected,
  related,
  onSelect
}: {
  node: HomeMemoryGraphNode;
  highlighted: boolean;
  selected: boolean;
  related: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const groupRef = React.useRef<THREE.Group>(null);
  const color = NODE_COLORS[node.kind];
  const radius = nodeRadius(node);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const pulse = selected || highlighted ? 1 + Math.sin(clock.elapsedTime * 4.2) * (selected ? 0.08 : 0.05) : 1;
    groupRef.current.scale.setScalar(pulse);
  });

  function handleClick(event: ThreeEvent<MouseEvent>): void {
    event.stopPropagation();
    onSelect();
  }

  return (
    <group ref={groupRef} position={toVector(node)}>
      <mesh onClick={handleClick} castShadow>
        <sphereGeometry args={[highlighted ? radius + 0.05 : radius, 32, 24]} />
        <meshStandardMaterial
          color={highlighted ? HIGHLIGHT_COLOR : color}
          emissive={highlighted ? HIGHLIGHT_COLOR : color}
          emissiveIntensity={selected ? 0.38 : highlighted ? 0.34 : related ? 0.16 : 0.05}
          roughness={0.62}
        />
      </mesh>
      {selected || related || highlighted ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 1.28, radius * 1.82, 42]} />
          <meshBasicMaterial
            color={highlighted ? HIGHLIGHT_COLOR : color}
            transparent
            opacity={selected ? 0.42 : highlighted ? 0.36 : 0.2}
          />
        </mesh>
      ) : null}
      {shouldShowNodeLabel(node.kind, selected, related, highlighted) ? (
        <Text
          anchorX="center"
          anchorY="middle"
          color="#17202a"
          fontSize={labelSize(node.kind)}
          maxWidth={node.kind === 'hypothesis' ? 3.8 : node.kind === 'semantic' ? 3.1 : 2.5}
          outlineColor="#f7fbfb"
          outlineWidth={0.025}
          position={[0, radius + 0.34, 0]}
        >
          {node.label}
        </Text>
      ) : null}
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
  if (node.kind === 'semantic') return 0.26 + activityBoost;
  if (node.kind === 'field') return 0.22 + activityBoost;
  return 0.28 + activityBoost;
}

function shouldShowNodeLabel(kind: HomeMemoryGraphNodeKind, selected: boolean, related: boolean, highlighted: boolean): boolean {
  return selected || related || highlighted || kind === 'home' || kind === 'room' || kind === 'hypothesis';
}

function labelSize(kind: HomeMemoryGraphNodeKind): number {
  if (kind === 'home') return 0.28;
  if (kind === 'hypothesis') return 0.2;
  if (kind === 'semantic') return 0.18;
  return 0.18;
}

function edgeColor(kind: string): string {
  if (kind === 'supports') return '#9b4d4d';
  if (kind === 'interprets') return '#7353a8';
  if (kind === 'observes') return '#8a6f2a';
  if (kind === 'co-occurs') return '#2f6f9f';
  return '#697b78';
}
