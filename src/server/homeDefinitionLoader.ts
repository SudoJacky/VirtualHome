import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { deviceCapabilities } from '../shared/deviceRegistry';
import type { HomeDefinition } from '../shared/types';

const roomIds = [
  'entrance',
  'living_room',
  'kitchen',
  'dining_room',
  'master_bedroom',
  'child_bedroom',
  'study',
  'bathroom',
  'garden'
] as const;

const roomIdSchema = z.enum(roomIds);

const roomDefinitionSchema = z.object({
  id: roomIdSchema,
  name: z.string().min(1),
  type: z.enum(['entry', 'living', 'utility', 'bedroom', 'work', 'outdoor']),
  connectedRooms: z.array(roomIdSchema)
});

const personDefinitionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['human', 'pet']),
  role: z.string().min(1),
  homeMember: z.boolean()
});

const deviceDefinitionSchema = z.object({
  id: z.string().min(1),
  roomId: roomIdSchema,
  type: z.string().min(1),
  name: z.string().min(1),
  metrics: z.array(z.string().min(1))
});

const homeDefinitionSchema = z.object({
  building: z.object({
    id: z.string().min(1),
    name: z.string().min(1)
  }),
  floors: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    level: z.number().int(),
    rooms: z.array(roomDefinitionSchema),
    fixtures: z.object({
      devices: z.array(deviceDefinitionSchema)
    })
  })).min(1),
  topology: z.object({
    connections: z.array(z.object({
      from: roomIdSchema,
      to: roomIdSchema
    }))
  }),
  people: z.array(personDefinitionSchema)
});

export function parseHomeDefinition(input: unknown): HomeDefinition {
  const result = homeDefinitionSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid home definition: ${details}`);
  }
  const issues = validateHomeDefinitionReferences(result.data as HomeDefinition);
  if (issues.length > 0) {
    throw new Error(`Invalid home definition: ${issues.join('; ')}`);
  }
  return structuredClone(result.data) as HomeDefinition;
}

export function loadHomeDefinitionFromFile(filePath: string): HomeDefinition {
  return parseHomeDefinition(JSON.parse(readFileSync(filePath, 'utf8')));
}

function validateHomeDefinitionReferences(homeDefinition: HomeDefinition): string[] {
  const issues: string[] = [];
  const rooms = homeDefinition.floors.flatMap((floor) => floor.rooms);
  const devices = homeDefinition.floors.flatMap((floor) => floor.fixtures.devices);
  const roomIds = new Set(rooms.map((room) => room.id));

  issues.push(...findDuplicateIds(rooms.map((room) => room.id), 'room'));
  issues.push(...findDuplicateIds(devices.map((device) => device.id), 'device'));
  issues.push(...findDuplicateIds(homeDefinition.people.map((person) => person.id), 'person'));

  for (const floor of homeDefinition.floors) {
    for (const room of floor.rooms) {
      for (const connectedRoom of room.connectedRooms) {
        if (!roomIds.has(connectedRoom)) {
          issues.push(`room ${room.id} references missing connected room ${connectedRoom}`);
        }
      }
    }

    for (const device of floor.fixtures.devices) {
      if (!roomIds.has(device.roomId)) {
        issues.push(`device ${device.id} references missing room ${device.roomId}`);
      }
      if (!deviceCapabilities[device.type]) {
        issues.push(`unsupported device type ${device.type} for device ${device.id}`);
      }
    }
  }

  for (const connection of homeDefinition.topology.connections) {
    const missingRooms = [connection.from, connection.to].filter((roomId) => !roomIds.has(roomId));
    for (const missingRoom of missingRooms) {
      issues.push(`topology connection ${connection.from}->${connection.to} references missing room ${missingRoom}`);
    }
  }

  return issues;
}

function findDuplicateIds(ids: string[], label: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return [...duplicates].map((id) => `duplicate ${label} id ${id}`);
}
