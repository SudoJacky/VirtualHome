import type {
  ResidentChronotype,
  ResidentMobility,
  ResidentProfileDefinition,
  ResidentRole
} from '../../shared/types';

export type PersonaRole = ResidentRole;
export type Chronotype = ResidentChronotype;
export type MobilityLevel = ResidentMobility;

export interface PersonaProfile extends ResidentProfileDefinition {
  personId: string;
}
