import { getDefaultHouseholdObjects, objectsWithAffordance } from './objects';
import type { RoomId } from '../../shared/types';

export interface ActivityAffordance {
  objectId: string;
  roomId: RoomId;
  affordance: string;
}

export function getAffordancesForActivity(activityId: string): ActivityAffordance[] {
  return objectsWithAffordance(getDefaultHouseholdObjects(), activityId).map((object) => ({
    objectId: object.id,
    roomId: object.roomId,
    affordance: activityId
  }));
}
