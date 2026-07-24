import { z } from 'zod';
import { deviceCapabilities } from './deviceRegistry';
import type { HomeDefinition } from './types';

const roomIdSchema = z.string().min(1);

const roomDefinitionSchema = z.object({
  id: roomIdSchema,
  name: z.string().min(1),
  type: z.enum(['entry', 'living', 'utility', 'bedroom', 'work', 'outdoor']),
  connectedRooms: z.array(roomIdSchema),
  purposes: z.array(z.string().min(1)).optional()
});

const residentProfileSchema = z.object({
  role: z.enum(['commuter', 'remote_worker', 'student', 'senior', 'home_adult', 'pet']),
  ageBand: z.enum(['child', 'adult', 'senior', 'pet']),
  chronotype: z.enum(['early', 'neutral', 'late']),
  sleepNeedHours: z.number().positive(),
  mealRegularity: z.number().min(0).max(1),
  chorePreference: z.number().min(0).max(1),
  riskSensitivity: z.number().min(0).max(1),
  sociability: z.number().min(0).max(1),
  mobility: z.enum(['limited', 'steady', 'active']),
  primaryRooms: z.array(roomIdSchema),
  deviceFamiliarity: z.record(z.string().min(1), z.number().min(0).max(1)),
  careResponsibilities: z.array(z.string().min(1))
});

const personDefinitionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['human', 'pet']),
  role: z.string().min(1),
  homeMember: z.boolean(),
  profile: residentProfileSchema.optional()
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

function validateHomeDefinitionReferences(homeDefinition: HomeDefinition): string[] {
  const issues: string[] = [];
  const rooms = homeDefinition.floors.flatMap((floor) => floor.rooms);
  const devices = homeDefinition.floors.flatMap((floor) => floor.fixtures.devices);
  const roomIds = new Set(rooms.map((room) => room.id));
  const deviceIds = new Set(devices.map((device) => device.id));

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
        continue;
      }
      const supportedMetrics = supportedMetricNamesForDeviceType(device.type);
      for (const metric of device.metrics) {
        if (!supportedMetrics.has(metric)) {
          issues.push(`device ${device.id} declares unsupported metric ${metric}`);
        }
      }
    }
  }

  for (const connection of homeDefinition.topology.connections) {
    const missingRooms = [connection.from, connection.to].filter((roomId) => !roomIds.has(roomId));
    for (const missingRoom of missingRooms) {
      issues.push(`topology connection ${connection.from}->${connection.to} references missing room ${missingRoom}`);
    }
  }

  for (const person of homeDefinition.people) {
    if (!person.profile) {
      continue;
    }
    for (const roomId of person.profile.primaryRooms) {
      if (!roomIds.has(roomId)) {
        issues.push(`person ${person.id} profile references missing primary room ${roomId}`);
      }
    }
    for (const deviceId of Object.keys(person.profile.deviceFamiliarity)) {
      if (!deviceIds.has(deviceId)) {
        issues.push(`person ${person.id} profile references missing familiar device ${deviceId}`);
      }
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

function supportedMetricNamesForDeviceType(deviceType: string): Set<string> {
  const capability = deviceCapabilities[deviceType];
  const names = new Set<string>();
  for (const metric of Object.keys(capability.telemetry)) {
    names.add(metric);
    names.add(toSnakeCase(metric));
  }
  return names;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}
