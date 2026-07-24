import type { HomeInferenceFeature } from './homeInferenceFeatures';
import type { HomeMemory } from './homeMemoryModel';

export type HomeRoleSlotKind =
  | 'main_sleep_slot'
  | 'child_sleep_slot'
  | 'child_activity_slot'
  | 'remote_work_slot'
  | 'commuter_adult_like_slot'
  | 'daytime_home_work_slot'
  | 'departure_return_slot'
  | 'dinner_prep_slot'
  | 'shared_evening_slot'
  | 'pet_activity_candidate';

export interface HomeRoleSlot {
  id: string;
  kind: HomeRoleSlotKind;
  confidence: number;
  supportingFeatureIds: string[];
  contradictingFeatureIds: string[];
  missingEvidence: string[];
  alternativeExplanations: string[];
}

export function extractHomeRoleSlots(memory: HomeMemory, features: HomeInferenceFeature[]): HomeRoleSlot[] {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const slots: HomeRoleSlot[] = [];

  const childSleep = byId.get('feature:early_sleep_zone_around_21');
  if (childSleep) {
    slots.push(roleSlot({
      kind: 'child_sleep_slot',
      supportingFeatureIds: [childSleep.id],
      confidence: cappedRoleConfidence(childSleep.confidence),
      missingEvidence: [
        'No direct identity evidence links this sleep routine to a specific person.',
        'No school calendar or schedule evidence is available.'
      ],
      alternativeExplanations: [
        'A bedroom sleep routine does not identify the resident.',
        'The same resident may account for other compatible routines.'
      ]
    }));
  }

  if (patternExists(memory, 'main-sleep-start')) {
    slots.push(roleSlot({
      kind: 'main_sleep_slot',
      supportingFeatureIds: ['pattern:main-sleep-start'],
      confidence: patternConfidence(memory, 'main-sleep-start'),
      missingEvidence: [
        'No direct occupant count evidence is available for the main sleep zone.',
        'No identity evidence links the sleep zone to named residents.'
      ],
      alternativeExplanations: [
        'A main sleep zone may represent one or more residents.',
        'Sleep sensor activity does not identify who used the room.'
      ]
    }));
  }

  const departureReturn = byId.get('feature:door_unlock_lock_pairing');
  if (
    departureReturn &&
    patternExists(memory, 'main-sleep-start') &&
    patternExists(memory, 'weekday-breakfast-fridge') &&
    patternExists(memory, 'robot-vacuum-after-departure')
  ) {
    slots.push(roleSlot({
      kind: 'commuter_adult_like_slot',
      supportingFeatureIds: [
        departureReturn.id,
        'pattern:main-sleep-start',
        'pattern:weekday-breakfast-fridge',
        'pattern:robot-vacuum-after-departure'
      ],
      confidence: cappedRoleConfidence(average([
        departureReturn.confidence,
        patternConfidence(memory, 'main-sleep-start'),
        patternConfidence(memory, 'weekday-breakfast-fridge'),
        patternConfidence(memory, 'robot-vacuum-after-departure')
      ])),
      missingEvidence: [
        'No direct identity evidence links the departure routine to a named or known resident.',
        'Door access evidence does not prove exactly who left.'
      ],
      alternativeExplanations: [
        'The commute-like routine may be produced by one household member or a recurring visitor.',
        'Some morning device routines may be automation triggered after departure rather than direct human action.'
      ]
    }));
  }

  const remoteWork = byId.get('feature:weekday_study_daytime_activity');
  if (remoteWork) {
    slots.push(roleSlot({
      kind: 'remote_work_slot',
      supportingFeatureIds: [remoteWork.id],
      confidence: cappedRoleConfidence(remoteWork.confidence),
      missingEvidence: [
        'No person identity evidence links study activity to a resident.',
        'No work calendar or application evidence is available.'
      ],
      alternativeExplanations: [
        'Study-room weekday activity may be work, study, or another focused task.',
        'The same resident may account for this and other household routines.'
      ]
    }));
  }

  if (departureReturn) {
    slots.push(roleSlot({
      kind: 'departure_return_slot',
      supportingFeatureIds: [departureReturn.id],
      confidence: cappedRoleConfidence(departureReturn.confidence),
      missingEvidence: [
        'Door access evidence is household-level and does not identify who left or returned.',
        'No direct room transition chain links the door event to a specific resident.'
      ],
      alternativeExplanations: [
        'Door unlock and lock may be produced by visitors, deliveries, or one household member.',
        'A door access sequence does not prove the whole household left or returned.'
      ]
    }));
  }

  if (remoteWork && patternExists(memory, 'laundry-running') && patternExists(memory, 'dinner-stove')) {
    const lunchSupport = patternExists(memory, 'weekday-lunch-fridge') ? ['pattern:weekday-lunch-fridge'] : [];
    slots.push(roleSlot({
      kind: 'daytime_home_work_slot',
      supportingFeatureIds: [
        remoteWork.id,
        ...lunchSupport,
        'pattern:laundry-running',
        'pattern:dinner-stove'
      ],
      confidence: cappedRoleConfidence(average([
        remoteWork.confidence,
        patternConfidence(memory, 'laundry-running'),
        patternConfidence(memory, 'dinner-stove')
      ])),
      missingEvidence: [
        'No direct identity evidence links weekday study activity, laundry, or dinner preparation to a named resident.',
        'No work calendar or application evidence confirms occupational work.'
      ],
      alternativeExplanations: [
        'The daytime-home slot may reflect remote work, study, household administration, or another focused task.',
        'Laundry and dinner preparation may be shared across residents even if they co-occur with weekday home presence.'
      ]
    }));
  }

  if (childSleep && departureReturn) {
    slots.push(roleSlot({
      kind: 'child_activity_slot',
      supportingFeatureIds: [
        childSleep.id,
        departureReturn.id
      ],
      confidence: cappedRoleConfidence(average([childSleep.confidence, departureReturn.confidence])),
      missingEvidence: [
        'No school calendar or direct identity evidence is available.',
        'Door access evidence is household-level and does not identify which resident left.'
      ],
      alternativeExplanations: [
        'A child-bedroom sleep routine can support a child activity slot but does not identify a specific person.',
        'Morning departure may include multiple household members.'
      ]
    }));
  }

  const dinnerPrep = byId.get('feature:stove_range_hood_coupling');
  if (dinnerPrep) {
    slots.push(roleSlot({
      kind: 'dinner_prep_slot',
      supportingFeatureIds: [dinnerPrep.id],
      confidence: cappedRoleConfidence(dinnerPrep.confidence),
      missingEvidence: [
        'No person identity evidence links cooking activity to a resident.',
        'No dining participation evidence proves how many residents shared the meal.'
      ],
      alternativeExplanations: [
        'Cooking device coupling may reflect one resident preparing food for themselves or others.',
        'Automation may contribute to range hood activity.'
      ]
    }));
  }

  if (patternExists(memory, 'living-evening-media')) {
    slots.push(roleSlot({
      kind: 'shared_evening_slot',
      supportingFeatureIds: ['pattern:living-evening-media'],
      confidence: patternConfidence(memory, 'living-evening-media'),
      missingEvidence: [
        'No co-presence evidence confirms multiple residents were in the living room.',
        'No person identity evidence is available for media usage.'
      ],
      alternativeExplanations: [
        'Evening media activity may be individual or shared household usage.',
        'Device usage does not identify who was present.'
      ]
    }));
  }

  if (patternExists(memory, 'garden-camera-motion')) {
    const sprinklerSupport = patternExists(memory, 'garden-summer-morning-sprinkler')
      ? ['pattern:garden-summer-morning-sprinkler']
      : [];
    slots.push(roleSlot({
      kind: 'pet_activity_candidate',
      supportingFeatureIds: ['pattern:garden-camera-motion', ...sprinklerSupport],
      confidence: Math.min(0.64, patternConfidence(memory, 'garden-camera-motion')),
      missingEvidence: [
        'No direct pet device, feeding, or identification evidence is available.',
        'Garden motion evidence does not identify the source of movement.'
      ],
      alternativeExplanations: [
        'Garden motion may be outdoor activity, visitors, wind, or wildlife.',
        'Camera motion alone does not confirm pet presence.'
      ]
    }));
  }

  return slots.sort((left, right) => left.kind.localeCompare(right.kind));
}

function roleSlot(input: Omit<HomeRoleSlot, 'id' | 'contradictingFeatureIds'> & { contradictingFeatureIds?: string[] }): HomeRoleSlot {
  return {
    id: `role-slot:${input.kind}`,
    kind: input.kind,
    confidence: clamp(input.confidence),
    supportingFeatureIds: [...input.supportingFeatureIds],
    contradictingFeatureIds: input.contradictingFeatureIds ?? [],
    missingEvidence: [...input.missingEvidence],
    alternativeExplanations: [...input.alternativeExplanations]
  };
}

function cappedRoleConfidence(confidence: number): number {
  return Math.min(0.82, confidence);
}

function patternExists(memory: HomeMemory, patternId: string): boolean {
  return Boolean(memory.profilePatterns[patternId]);
}

function patternConfidence(memory: HomeMemory, patternId: string): number {
  const pattern = memory.profilePatterns[patternId];
  if (!pattern) {
    return 0.1;
  }
  return cappedRoleConfidence(0.35 + Math.min(0.45, pattern.dates.length / 40));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0.1;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0.01, Number(value.toFixed(3))));
}
