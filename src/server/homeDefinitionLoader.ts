import { readFileSync } from 'node:fs';
import { z } from 'zod';
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
  return structuredClone(result.data) as HomeDefinition;
}

export function loadHomeDefinitionFromFile(filePath: string): HomeDefinition {
  return parseHomeDefinition(JSON.parse(readFileSync(filePath, 'utf8')));
}
