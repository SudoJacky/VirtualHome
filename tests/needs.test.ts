import { describe, expect, it } from 'vitest';
import { applyActivityEffectsToNeeds, createInitialNeeds, advanceNeeds } from '../src/sim/agents/needs';
import { getPersona } from '../src/sim/personas/defaultFamily';

describe('person needs', () => {
  it('accumulates hunger and fatigue while awake and relieves sleepiness while sleeping', () => {
    const adult = getPersona('adult_1');
    const awakeNeeds = advanceNeeds(createInitialNeeds(adult), adult, {
      minutes: 180,
      activity: 'remote_work',
      homeMode: 'morning'
    });
    const sleptNeeds = advanceNeeds(createInitialNeeds(adult), adult, {
      minutes: 180,
      activity: 'sleeping',
      homeMode: 'sleeping'
    });

    expect(awakeNeeds.hunger).toBeGreaterThan(50);
    expect(awakeNeeds.fatigue).toBeGreaterThan(35);
    expect(sleptNeeds.sleepiness).toBeLessThan(20);
    expect(sleptNeeds.sleepDebt).toBeLessThan(awakeNeeds.sleepDebt);
  });

  it('applies activity effects to the matching dynamic needs', () => {
    const adult = getPersona('adult_1');
    const hungryNeeds = {
      ...createInitialNeeds(adult),
      hunger: 88,
      sleepiness: 74,
      healthConcern: 42
    };

    const afterFood = applyActivityEffectsToNeeds(hungryNeeds, 'eat_simple_food');
    const afterSleep = applyActivityEffectsToNeeds(hungryNeeds, 'sleep');
    const afterMedicine = applyActivityEffectsToNeeds(hungryNeeds, 'take_medicine');

    expect(afterFood.hunger).toBeLessThan(hungryNeeds.hunger);
    expect(afterSleep.sleepiness).toBeLessThan(hungryNeeds.sleepiness);
    expect(afterMedicine.healthConcern).toBeLessThan(hungryNeeds.healthConcern);
  });
});
