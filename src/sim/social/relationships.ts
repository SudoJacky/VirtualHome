export type RelationshipKind =
  | 'spouse'
  | 'parent_child'
  | 'adult_senior'
  | 'family_pet'
  | 'co_resident';

export interface HouseholdRelationship {
  fromId: string;
  toId: string;
  kind: RelationshipKind;
  closeness: number;
  authority: number;
  careDuty: number;
}

const relationships: HouseholdRelationship[] = [
  relationship('adult_1', 'adult_2', 'spouse', 0.86, 0.45, 0.62),
  relationship('adult_2', 'adult_1', 'spouse', 0.86, 0.45, 0.62),
  relationship('adult_1', 'child_1', 'parent_child', 0.88, 0.9, 0.85),
  relationship('adult_2', 'child_1', 'parent_child', 0.84, 0.86, 0.82),
  relationship('child_1', 'adult_1', 'parent_child', 0.82, 0.18, 0.15),
  relationship('child_1', 'adult_2', 'parent_child', 0.8, 0.18, 0.15),
  relationship('adult_1', 'senior_1', 'adult_senior', 0.78, 0.52, 0.75),
  relationship('adult_2', 'senior_1', 'adult_senior', 0.74, 0.5, 0.68),
  relationship('senior_1', 'adult_1', 'adult_senior', 0.76, 0.35, 0.42),
  relationship('senior_1', 'adult_2', 'adult_senior', 0.72, 0.35, 0.38),
  relationship('adult_1', 'pet_1', 'family_pet', 0.7, 0.55, 0.45),
  relationship('adult_2', 'pet_1', 'family_pet', 0.68, 0.55, 0.42),
  relationship('child_1', 'pet_1', 'family_pet', 0.82, 0.3, 0.3),
  relationship('senior_1', 'pet_1', 'family_pet', 0.58, 0.25, 0.22),
  relationship('pet_1', 'adult_1', 'family_pet', 0.7, 0.05, 0),
  relationship('pet_1', 'adult_2', 'family_pet', 0.68, 0.05, 0),
  relationship('pet_1', 'child_1', 'family_pet', 0.82, 0.05, 0),
  relationship('pet_1', 'senior_1', 'family_pet', 0.58, 0.05, 0)
];

export function getRelationshipNetwork(): HouseholdRelationship[] {
  return relationships.map((entry) => ({ ...entry }));
}

export function getRelationship(fromId: string, toId: string): HouseholdRelationship | undefined {
  const match = relationships.find((entry) => entry.fromId === fromId && entry.toId === toId);
  return match ? { ...match } : undefined;
}

function relationship(
  fromId: string,
  toId: string,
  kind: RelationshipKind,
  closeness: number,
  authority: number,
  careDuty: number
): HouseholdRelationship {
  return { fromId, toId, kind, closeness, authority, careDuty };
}
