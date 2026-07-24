import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseHomeDefinition } from '../shared/homeDefinition';
import type { HomeDefinition, PersonDefinition, RoomDefinition } from '../shared/types';
import { createExternalContext, type ExternalContext, type WeatherCondition } from './externalContext';
import {
  coreHouseholdRepertoire,
  type LifeEventDefinition,
  type LifeEventHabit,
  type LifeEventRepertoire
} from './lifeEventRepertoire';
import { SeededRandom } from './random';
import type { ScenarioAction, ScenarioDefinition, ScenarioStep } from './scenarios';
import { coreDeviceBehaviorModule, type DeviceBehaviorModule } from './deviceBehavior';
import {
  coreAutomationPolicyModule,
  validateAutomationPolicyModule,
  type AutomationPolicyModule
} from './automationPolicy';

export const householdTemplateSchemaVersion = 'virtualhome.household/v1' as const;
export const householdCompilerVersion = '1.0.0' as const;

export type HouseholdHabit = LifeEventHabit;

export interface HouseholdTemplate {
  schemaVersion: typeof householdTemplateSchemaVersion;
  id: string;
  version: string;
  name: string;
  home: Omit<HomeDefinition, 'people'>;
  residents: PersonDefinition[];
  environment: {
    timezone: string;
    utcOffset: string;
    weather:
      | { mode: 'generated'; condition?: WeatherCondition }
      | { mode: 'fixed'; condition: WeatherCondition; outdoorTemperatureC: number; precipitationMm: number };
  };
  repertoires: Array<{ id: string; version: string }>;
  behaviors: Array<{ id: string; version: string }>;
  automation: { id: string; version: string };
  habits: HouseholdHabit[];
}

export interface CompileHouseholdRunRequest {
  date: string;
  seed: number;
}

export interface HouseholdCompilerOptions {
  repertoires?: readonly LifeEventRepertoire[];
  behaviors?: readonly DeviceBehaviorModule[];
  automationPolicies?: readonly AutomationPolicyModule[];
}

export interface CompiledHouseholdRun {
  templateId: string;
  templateVersion: string;
  templateDigest: string;
  compilerVersion: string;
  date: string;
  timezone: string;
  seed: number;
  repertoireVersions: Record<string, string>;
  behaviorVersions: Record<string, string>;
  automationPolicyVersion: { id: string; version: string };
  homeDefinition: HomeDefinition;
  environmentSnapshot: ExternalContext;
  lifePlan: ScenarioDefinition;
}

export interface HouseholdTemplateIssue {
  code: string;
  path: string;
  message: string;
}

export class HouseholdTemplateCompileError extends Error {
  readonly code = 'HOUSEHOLD_TEMPLATE_INVALID';

  constructor(readonly issues: HouseholdTemplateIssue[]) {
    super(`Invalid household template: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  }
}

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const compileRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidDate, { message: 'invalid calendar date' }),
  seed: z.number().int().min(0).max(0xffffffff)
}).strict();
const weatherConditionSchema = z.enum(['clear', 'cloudy', 'light_rain', 'heavy_rain', 'hot', 'cold']);
const habitSchema = z.object({
  id: z.string().min(1),
  repertoire: z.string().min(1),
  activity: z.string().min(1),
  residentIds: z.array(z.string().min(1)).min(1),
  recurrence: z.enum(['daily', 'weekdays', 'weekends', 'workdays', 'schooldays']),
  window: z.object({ start: timeSchema, end: timeSchema }).strict(),
  roomId: z.string().min(1).optional(),
  roomPurpose: z.string().min(1).optional(),
  probability: z.number().min(0).max(1).optional()
}).strict().superRefine((habit, context) => {
  if (habit.roomId && habit.roomPurpose) {
    context.addIssue({ code: 'custom', path: ['roomPurpose'], message: 'roomId and roomPurpose are mutually exclusive' });
  }
});

const householdTemplateSchema = z.object({
  schemaVersion: z.literal(householdTemplateSchemaVersion),
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  home: z.object({
    building: z.unknown(),
    floors: z.unknown(),
    topology: z.unknown()
  }).passthrough(),
  residents: z.array(z.unknown()),
  environment: z.object({
    timezone: z.string().min(1),
    utcOffset: z.string().regex(/^[+-](0\d|1[0-4]):[0-5]\d$/),
    weather: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('generated'), condition: weatherConditionSchema.optional() }).strict(),
      z.object({
        mode: z.literal('fixed'),
        condition: weatherConditionSchema,
        outdoorTemperatureC: z.number(),
        precipitationMm: z.number().min(0)
      }).strict()
    ])
  }).strict(),
  repertoires: z.array(z.object({
    id: z.string().min(1),
    version: z.string().min(1)
  }).strict()).min(1),
  behaviors: z.array(z.object({
    id: z.string().min(1),
    version: z.string().min(1)
  }).strict()).min(1),
  automation: z.object({
    id: z.string().min(1),
    version: z.string().min(1)
  }).strict(),
  habits: z.array(habitSchema)
}).strict();

export function compileHouseholdRun(
  input: unknown,
  request: CompileHouseholdRunRequest,
  options: HouseholdCompilerOptions = {}
): CompiledHouseholdRun {
  const parsedRequest = compileRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new HouseholdTemplateCompileError(parsedRequest.error.issues.map((issue) => ({
      code: 'REQUEST_INVALID',
      path: `request.${issue.path.join('.')}`,
      message: issue.message
    })));
  }
  const validatedRequest = parsedRequest.data;
  const parsed = householdTemplateSchema.safeParse(input);
  if (!parsed.success) {
    throw new HouseholdTemplateCompileError(parsed.error.issues.map((issue) => ({
      code: 'SCHEMA_INVALID',
      path: issue.path.join('.') || 'root',
      message: issue.message
    })));
  }

  let homeDefinition: HomeDefinition;
  try {
    homeDefinition = parseHomeDefinition({ ...parsed.data.home, people: parsed.data.residents });
  } catch (error) {
    throw new HouseholdTemplateCompileError([{
      code: 'HOME_INVALID',
      path: 'home',
      message: error instanceof Error ? error.message : String(error)
    }]);
  }

  const template = {
    ...parsed.data,
    home: { ...homeDefinition, people: undefined },
    residents: homeDefinition.people
  } as unknown as HouseholdTemplate;
  const repertoireResolution = resolveRepertoires(template, options.repertoires ?? []);
  const behaviorResolution = resolveBehaviors(template, options.behaviors ?? []);
  const automationResolution = resolveAutomationPolicy(template, options.automationPolicies ?? []);
  const issues = [
    ...repertoireResolution.issues,
    ...behaviorResolution.issues,
    ...automationResolution.issues,
    ...validateCompatibility(template, homeDefinition, repertoireResolution.selected, behaviorResolution.selected, validatedRequest)
  ].sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  if (issues.length > 0) {
    throw new HouseholdTemplateCompileError(issues);
  }

  const environmentSnapshot = resolveEnvironment(template, validatedRequest);
  const lifePlan = compileLifePlan(
    template,
    homeDefinition,
    environmentSnapshot,
    validatedRequest,
    repertoireResolution.selected
  );
  return {
    templateId: template.id,
    templateVersion: template.version,
    templateDigest: digestTemplate(parsed.data),
    compilerVersion: householdCompilerVersion,
    date: validatedRequest.date,
    timezone: template.environment.timezone,
    seed: validatedRequest.seed >>> 0,
    repertoireVersions: Object.fromEntries(template.repertoires.map((repertoire) => [repertoire.id, repertoire.version])),
    behaviorVersions: Object.fromEntries(template.behaviors.map((behavior) => [behavior.id, behavior.version])),
    automationPolicyVersion: {
      id: automationResolution.selected!.id,
      version: automationResolution.selected!.version
    },
    homeDefinition,
    environmentSnapshot,
    lifePlan
  };
}

export function householdTemplateDate(input: unknown, now = new Date()): string {
  const result = z.object({
    environment: z.object({ timezone: z.string().min(1) }).passthrough()
  }).passthrough().safeParse(input);
  if (!result.success) {
    throw new HouseholdTemplateCompileError(result.error.issues.map((issue) => ({
      code: 'SCHEMA_INVALID',
      path: issue.path.join('.') || 'root',
      message: issue.message
    })));
  }
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: result.data.environment.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch (error) {
    throw new HouseholdTemplateCompileError([{
      code: 'INVALID_TIMEZONE',
      path: 'environment.timezone',
      message: error instanceof Error ? error.message : String(error)
    }]);
  }
}

interface RepertoireResolution {
  selected: Map<string, LifeEventRepertoire>;
  issues: HouseholdTemplateIssue[];
}

function resolveRepertoires(
  template: HouseholdTemplate,
  additionalRepertoires: readonly LifeEventRepertoire[]
): RepertoireResolution {
  const available = [coreHouseholdRepertoire, ...additionalRepertoires];
  const availableByIdentity = new Map<string, LifeEventRepertoire>();
  const issues: HouseholdTemplateIssue[] = [];
  for (const [index, repertoire] of available.entries()) {
    const key = `${repertoire.id}@${repertoire.version}`;
    if (availableByIdentity.has(key)) {
      issues.push({
        code: 'DUPLICATE_REPERTOIRE_MODULE',
        path: `compiler.repertoires.${index}`,
        message: `duplicate repertoire module ${key}`
      });
      continue;
    }
    availableByIdentity.set(key, repertoire);
  }

  const selected = new Map<string, LifeEventRepertoire>();
  for (const [index, reference] of template.repertoires.entries()) {
    if (selected.has(reference.id)) {
      issues.push({
        code: 'DUPLICATE_ID',
        path: `repertoires.${index}.id`,
        message: `duplicate repertoire reference ${reference.id}`
      });
      continue;
    }
    const repertoire = availableByIdentity.get(`${reference.id}@${reference.version}`);
    if (!repertoire) {
      issues.push({
        code: 'MISSING_REPERTOIRE',
        path: `repertoires.${index}`,
        message: `repertoire module ${reference.id}@${reference.version} is not installed`
      });
      continue;
    }
    selected.set(reference.id, repertoire);
  }
  return { selected, issues };
}

interface BehaviorResolution {
  selected: Map<string, DeviceBehaviorModule>;
  issues: HouseholdTemplateIssue[];
}

interface AutomationPolicyResolution {
  selected?: AutomationPolicyModule;
  issues: HouseholdTemplateIssue[];
}

function resolveAutomationPolicy(
  template: HouseholdTemplate,
  additionalPolicies: readonly AutomationPolicyModule[]
): AutomationPolicyResolution {
  const available = [coreAutomationPolicyModule, ...additionalPolicies];
  const availableByIdentity = new Map<string, AutomationPolicyModule>();
  const issues: HouseholdTemplateIssue[] = [];
  for (const [index, policy] of available.entries()) {
    const key = `${policy.id}@${policy.version}`;
    if (availableByIdentity.has(key)) {
      issues.push({
        code: 'DUPLICATE_AUTOMATION_POLICY',
        path: `compiler.automationPolicies.${index}`,
        message: `duplicate automation policy ${key}`
      });
      continue;
    }
    for (const message of validateAutomationPolicyModule(policy)) {
      issues.push({
        code: 'INVALID_AUTOMATION_POLICY',
        path: `compiler.automationPolicies.${index}`,
        message: `${key}: ${message}`
      });
    }
    availableByIdentity.set(key, policy);
  }

  const selected = availableByIdentity.get(`${template.automation.id}@${template.automation.version}`);
  if (!selected) {
    issues.push({
      code: 'MISSING_AUTOMATION_POLICY',
      path: 'automation',
      message: `automation policy ${template.automation.id}@${template.automation.version} is not installed`
    });
  }
  return { selected, issues };
}

function resolveBehaviors(
  template: HouseholdTemplate,
  additionalBehaviors: readonly DeviceBehaviorModule[]
): BehaviorResolution {
  const available = [coreDeviceBehaviorModule, ...additionalBehaviors];
  const availableByIdentity = new Map<string, DeviceBehaviorModule>();
  const issues: HouseholdTemplateIssue[] = [];
  for (const [index, behavior] of available.entries()) {
    const key = `${behavior.id}@${behavior.version}`;
    if (availableByIdentity.has(key)) {
      issues.push({
        code: 'DUPLICATE_BEHAVIOR_MODULE',
        path: `compiler.behaviors.${index}`,
        message: `duplicate behavior module ${key}`
      });
      continue;
    }
    availableByIdentity.set(key, behavior);
  }

  const selected = new Map<string, DeviceBehaviorModule>();
  for (const [index, reference] of template.behaviors.entries()) {
    if (selected.has(reference.id)) {
      issues.push({
        code: 'DUPLICATE_ID',
        path: `behaviors.${index}.id`,
        message: `duplicate behavior reference ${reference.id}`
      });
      continue;
    }
    const behavior = availableByIdentity.get(`${reference.id}@${reference.version}`);
    if (!behavior) {
      issues.push({
        code: 'MISSING_BEHAVIOR',
        path: `behaviors.${index}`,
        message: `behavior module ${reference.id}@${reference.version} is not installed`
      });
      continue;
    }
    selected.set(reference.id, behavior);
  }

  const deviceTypes = new Set([...selected.values()].flatMap((behavior) => [...behavior.deviceTypes]));
  for (const deviceType of deviceTypes) {
    const candidates = [...selected.values()].filter((behavior) => behavior.deviceTypes.includes(deviceType));
    if (candidates.length <= 1) {
      continue;
    }
    const explicitOwners = candidates.filter((candidate) => candidates
      .filter((other) => other.id !== candidate.id)
      .every((other) => candidate.replaces?.includes(other.id)));
    if (explicitOwners.length !== 1) {
      issues.push({
        code: 'AMBIGUOUS_DEVICE_BEHAVIOR',
        path: 'behaviors',
        message: `device type ${deviceType} has ambiguous owners ${candidates.map((candidate) => candidate.id).join(', ')}; one module must explicitly replace every other owner`
      });
    }
  }
  return { selected, issues };
}

function validateCompatibility(
  template: HouseholdTemplate,
  homeDefinition: HomeDefinition,
  repertoires: Map<string, LifeEventRepertoire>,
  behaviors: Map<string, DeviceBehaviorModule>,
  request: CompileHouseholdRunRequest
): HouseholdTemplateIssue[] {
  const issues: HouseholdTemplateIssue[] = [];
  const rooms = homeDefinition.floors.flatMap((floor) => floor.rooms);
  const roomIds = new Set(rooms.map((room) => room.id));
  const residentIds = new Set(homeDefinition.people.map((person) => person.id));
  const habitIds = new Set<string>();
  const supportedDeviceTypes = new Set([...behaviors.values()].flatMap((behavior) => [...behavior.deviceTypes]));

  try {
    const actualOffset = utcOffsetForDate(template.environment.timezone, request.date);
    if (actualOffset !== template.environment.utcOffset) {
      issues.push({
        code: 'TIMEZONE_OFFSET_MISMATCH',
        path: 'environment.utcOffset',
        message: `${template.environment.timezone} uses ${actualOffset} on ${request.date}, not ${template.environment.utcOffset}`
      });
    }
  } catch (error) {
    issues.push({
      code: 'INVALID_TIMEZONE',
      path: 'environment.timezone',
      message: error instanceof Error ? error.message : String(error)
    });
  }

  for (const [index, device] of homeDefinition.floors.flatMap((floor) => floor.fixtures.devices).entries()) {
    if (!supportedDeviceTypes.has(device.type)) {
      issues.push({
        code: 'UNSUPPORTED_DEVICE_BEHAVIOR',
        path: `home.devices.${index}.type`,
        message: `no selected behavior module owns device type ${device.type}`
      });
    }
  }

  for (const [index, habit] of template.habits.entries()) {
    if (habitIds.has(habit.id)) {
      issues.push({ code: 'DUPLICATE_ID', path: `habits.${index}.id`, message: `duplicate habit id ${habit.id}` });
    }
    habitIds.add(habit.id);
    const repertoire = repertoires.get(habit.repertoire);
    if (!template.repertoires.some((reference) => reference.id === habit.repertoire)) {
      issues.push({
        code: 'MISSING_REFERENCE',
        path: `habits.${index}.repertoire`,
        message: `habit references undeclared repertoire ${habit.repertoire}`
      });
    }
    const definition = repertoire?.activities[habit.activity];
    if (repertoire && !definition) {
      issues.push({
        code: 'UNSUPPORTED_ACTIVITY',
        path: `habits.${index}.activity`,
        message: `repertoire ${habit.repertoire}@${repertoire.version} does not define activity ${habit.activity}`
      });
    }
    for (const residentId of habit.residentIds) {
      if (!residentIds.has(residentId)) {
        issues.push({ code: 'MISSING_REFERENCE', path: `habits.${index}.residentIds`, message: `missing resident ${residentId}` });
      }
    }
    if (habit.roomId && !roomIds.has(habit.roomId)) {
      issues.push({ code: 'MISSING_REFERENCE', path: `habits.${index}.roomId`, message: `missing room ${habit.roomId}` });
    }
    if (minutesOfDay(habit.window.end) < minutesOfDay(habit.window.start)) {
      issues.push({ code: 'INVALID_WINDOW', path: `habits.${index}.window`, message: 'end must not be earlier than start' });
    }
    if (definition) {
      try {
        resolveHabitRoom(habit, rooms, definition);
      } catch (error) {
        issues.push({
          code: 'UNSATISFIED_AFFORDANCE',
          path: `habits.${index}`,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return issues;
}

function resolveEnvironment(template: HouseholdTemplate, request: CompileHouseholdRunRequest): ExternalContext {
  const generated = createExternalContext({
    date: request.date,
    seed: request.seed,
    overrides: template.environment.weather.mode === 'generated'
      ? { weatherCondition: template.environment.weather.condition }
      : { weatherCondition: template.environment.weather.condition }
  });
  if (template.environment.weather.mode === 'fixed') {
    generated.weather = {
      condition: template.environment.weather.condition,
      outdoorTemperatureC: template.environment.weather.outdoorTemperatureC,
      precipitationMm: template.environment.weather.precipitationMm
    };
  }
  return generated;
}

function compileLifePlan(
  template: HouseholdTemplate,
  homeDefinition: HomeDefinition,
  environment: ExternalContext,
  request: CompileHouseholdRunRequest,
  repertoires: Map<string, LifeEventRepertoire>
): ScenarioDefinition {
  const rooms = homeDefinition.floors.flatMap((floor) => floor.rooms);
  const devices = homeDefinition.floors.flatMap((floor) => floor.fixtures.devices);
  const initialPeople = Object.fromEntries(homeDefinition.people.map((resident) => {
    const initialRoom = resident.profile?.primaryRooms.find((roomId) => rooms.some((room) => room.id === roomId))
      ?? rooms.find((room) => room.type === (resident.kind === 'pet' ? 'living' : 'bedroom'))?.id
      ?? rooms[0]?.id;
    if (!initialRoom) {
      throw new HouseholdTemplateCompileError([{
        code: 'UNSATISFIED_AFFORDANCE',
        path: `residents.${resident.id}`,
        message: 'home has no room for initial resident location'
      }]);
    }
    return [resident.id, { location: initialRoom, activity: 'idle' }];
  }));

  const steps = template.habits
    .filter((habit) => recurrenceMatches(habit.recurrence, environment))
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((habit) => {
      const habitSeed = scopedSeed(request.seed, request.date, habit.id);
      const random = new SeededRandom(habitSeed);
      if (random.next() > (habit.probability ?? 1)) {
        return [];
      }
      const start = minutesOfDay(habit.window.start);
      const end = minutesOfDay(habit.window.end);
      const residents = habit.residentIds.map((residentId) => homeDefinition.people.find((resident) => resident.id === residentId)!);
      const minute = scheduleHabitMinute(habit, start, end, random.next(), residents);
      const repertoire = repertoires.get(habit.repertoire);
      const definition = repertoire?.activities[habit.activity];
      if (!definition) {
        throw new Error(`Validated life event ${habit.repertoire}.${habit.activity} is unavailable`);
      }
      return definition.compile({
        habit,
        minute,
        room: resolveHabitRoom(habit, rooms, definition),
        devices,
        residents,
        environment,
        seed: habitSeed
      });
    });

  return {
    id: `household_${template.id}_${request.date.replaceAll('-', '_')}`,
    name: `${template.name} ${request.date}`,
    startTime: `${request.date}T00:00:00${template.environment.utcOffset}`,
    speed: 60,
    initialMode: 'morning',
    initialPeople,
    calendar: {
      ...environment.calendar,
      weatherCondition: environment.weather.condition,
      outdoorTemperatureC: environment.weather.outdoorTemperatureC,
      precipitationMm: environment.weather.precipitationMm,
      profileFlags: []
    },
    steps: mergeSteps(steps)
  };
}

function resolveHabitRoom(
  habit: HouseholdHabit,
  rooms: RoomDefinition[],
  definition: LifeEventDefinition
): RoomDefinition {
  if (habit.roomId) {
    const room = rooms.find((candidate) => candidate.id === habit.roomId);
    if (room) return room;
    throw new Error(`room ${habit.roomId} does not exist`);
  }
  if (habit.roomPurpose) {
    const matches = rooms.filter((room) => room.purposes?.includes(habit.roomPurpose!));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`room purpose ${habit.roomPurpose} matches multiple rooms`);
    throw new Error(`room purpose ${habit.roomPurpose} matches no rooms`);
  }
  const preferredType = definition.preferredRoomType;
  const matches = rooms.filter((room) => room.type === preferredType);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`activity ${habit.activity} requires a ${preferredType} room`);
  throw new Error(`activity ${habit.activity} requires roomId or roomPurpose because ${preferredType} matches multiple rooms`);
}

function recurrenceMatches(recurrence: HouseholdHabit['recurrence'], context: ExternalContext): boolean {
  if (recurrence === 'daily') return true;
  if (recurrence === 'weekdays') return context.calendar.dayType === 'weekday';
  if (recurrence === 'weekends') return context.calendar.dayType === 'weekend';
  if (recurrence === 'workdays') return context.calendar.workday;
  return context.calendar.schoolDay;
}

function mergeSteps(steps: ScenarioStep[]): ScenarioStep[] {
  const actionsByMinute = new Map<number, ScenarioAction[]>();
  for (const step of steps) {
    actionsByMinute.set(step.minute, [...(actionsByMinute.get(step.minute) ?? []), ...step.actions]);
  }
  return [...actionsByMinute]
    .sort(([left], [right]) => left - right)
    .map(([minute, actions]) => ({ minute, actions }));
}

function minutesOfDay(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function scheduleHabitMinute(
  habit: HouseholdHabit,
  start: number,
  end: number,
  randomSample: number,
  residents: readonly PersonDefinition[]
): number {
  const profiles = residents.flatMap((resident) => resident.profile ? [resident.profile] : []);
  if (profiles.length === 0 || start === end) {
    return Math.round(start + (end - start) * randomSample);
  }

  const average = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  const chronotype = average(profiles.map((profile) => (
    profile.chronotype === 'early' ? 0.2 : profile.chronotype === 'late' ? 0.8 : 0.5
  )));
  const sleepNeed = average(profiles.map((profile) => Math.max(0, Math.min(1, (profile.sleepNeedHours - 6) / 4))));
  let profileTarget: number | null = null;
  let profileWeight = 0;

  if (habit.activity === 'wake_up') {
    profileTarget = (chronotype + sleepNeed) / 2;
    profileWeight = 0.75;
  } else if (habit.activity === 'sleep') {
    profileTarget = (chronotype + (1 - sleepNeed)) / 2;
    profileWeight = 0.75;
  } else if (habit.activity === 'meal') {
    const mealRegularity = average(profiles.map((profile) => profile.mealRegularity));
    profileTarget = 0.5;
    profileWeight = mealRegularity;
  }

  const fraction = profileTarget === null
    ? randomSample
    : randomSample * (1 - profileWeight) + profileTarget * profileWeight;
  return Math.round(start + (end - start) * fraction);
}

function isValidDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function utcOffsetForDate(timezone: string, date: string): string {
  const localMidnightAsUtc = new Date(`${date}T00:00:00Z`).getTime();
  let candidate = new Date(localMidnightAsUtc);
  for (let index = 0; index < 2; index += 1) {
    const offset = utcOffsetAtInstant(timezone, candidate);
    candidate = new Date(localMidnightAsUtc - utcOffsetMinutes(offset) * 60_000);
  }
  return utcOffsetAtInstant(timezone, candidate);
}

function utcOffsetAtInstant(timezone: string, instant: Date): string {
  const offsetName = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    timeZoneName: 'longOffset'
  }).formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (offsetName === 'GMT') {
    return '+00:00';
  }
  const match = offsetName?.match(/^GMT([+-]\d{2}:\d{2})$/);
  if (!match) {
    throw new Error(`cannot resolve UTC offset for timezone ${timezone}`);
  }
  return match[1];
}

function utcOffsetMinutes(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);
  return sign * (hours * 60 + minutes);
}

function scopedSeed(seed: number, date: string, scope: string): number {
  return [...`${seed}:${date}:${scope}`].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
}

function digestTemplate(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
