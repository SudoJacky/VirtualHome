import type { RoomId } from '../../shared/types';

export type PersonaRole = 'commuter' | 'remote_worker' | 'student' | 'senior' | 'pet';
export type Chronotype = 'early' | 'neutral' | 'late';
export type MobilityLevel = 'limited' | 'steady' | 'active';

export interface PersonaProfile {
  personId: string;
  role: PersonaRole;
  ageBand: 'child' | 'adult' | 'senior' | 'pet';
  chronotype: Chronotype;
  sleepNeedHours: number;
  mealRegularity: number;
  chorePreference: number;
  riskSensitivity: number;
  sociability: number;
  mobility: MobilityLevel;
  primaryRooms: RoomId[];
  deviceFamiliarity: Record<string, number>;
  careResponsibilities: string[];
}
