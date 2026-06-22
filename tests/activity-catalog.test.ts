import { describe, expect, it } from 'vitest';
import { getActivityTemplate, listActivityTemplates } from '../src/sim/agents/activityCatalog';

describe('activity catalog', () => {
  it('defines household activities with resources, duration, effects, and alternatives', () => {
    expect(listActivityTemplates().map((activity) => activity.id)).toEqual(expect.arrayContaining([
      'wake_up',
      'prepare_breakfast',
      'remote_work_session',
      'study_homework',
      'take_medicine',
      'refill_medicine',
      'pet_care'
    ]));
    expect(getActivityTemplate('prepare_breakfast')).toMatchObject({
      requiredResources: [{ resourceId: 'breakfast_food', quantity: 1 }],
      fallbackActivityIds: ['eat_simple_food'],
      effects: expect.arrayContaining([
        expect.objectContaining({ need: 'hunger', delta: expect.any(Number) })
      ])
    });
    expect(getActivityTemplate('refill_medicine')).toMatchObject({
      goals: expect.arrayContaining(['health', 'restock']),
      requiredResources: [{ resourceId: 'door_access', quantity: 1 }],
      targetRoom: 'entrance',
      steps: expect.arrayContaining(['order_refill', 'restock_medicine_box'])
    });
  });
});
