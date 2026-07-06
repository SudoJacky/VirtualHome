import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import { createHomeProfileHypotheses } from '../src/web/homeProfiler';

function homeMemoryDaysEvents(): DeviceValueEvent[] {
  const dataset = JSON.parse(readFileSync('data/home-memory-days.json', 'utf8')) as { events: DeviceValueEvent[] };
  return dataset.events;
}

describe('home memory dataset profile extraction', () => {
  it('extracts the stable household profile from home-memory-days without event-generator truth fields', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const hypotheses = createHomeProfileHypotheses(memory);
    const byId = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]));

    expect(byId.get('household:composition')?.summary).toMatch(/anonymous household roles/i);
    expect(byId.get('household:composition')?.summary).toMatch(/child-bedroom sleep routine/i);
    expect(byId.get('household:composition')?.summary).toMatch(/weekday daytime study\/work/i);
    expect(byId.get('household:composition')?.summary).toMatch(/weak garden pet\/activity candidate/i);
    expect(byId.get('household:composition')?.summary).toMatch(/does not.*confirm exact adult count/i);

    expect(byId.get('household:size')?.summary).toMatch(/resident-count model remains probabilistic/i);
    expect(byId.get('household:size')?.summary).toMatch(/not treated as ground truth for exactly 3 residents/i);
    expect(byId.get('resident-slot:remote_work:study')?.summary).toMatch(/weekday daytime/i);
    expect(byId.get('resident-slot:child_sleep:child_bedroom')?.summary).toMatch(/21:00|9 pm/i);
    expect(byId.get('resident-slot:main_sleep:master_bedroom')?.summary).toMatch(/22:00|10 pm/i);

    expect(byId.get('routine:weekday-breakfast:kitchen')?.summary).toMatch(/quick cold/i);
    expect(byId.get('routine:weekend-brunch:kitchen')?.summary).toMatch(/cooked brunch/i);
    expect(byId.get('routine:dinner:kitchen')?.summary).toMatch(/dinner/i);
    expect(byId.get('flow:kitchen:stove-range-hood')?.summary).toMatch(/range hood/i);
    expect(byId.get('flow:door-lock:paired')?.summary).toMatch(/unlock.*lock/i);
    expect(byId.get('routine:robot-vacuum:after-departure')?.summary).toMatch(/10 minute/i);
    expect(byId.get('routine:laundry:bathroom:cadence')?.summary).toMatch(/2 day/i);
    expect(byId.get('routine:garden:summer-sprinkler')?.summary).toMatch(/summer morning/i);
    expect(byId.get('activity:pet:garden')?.confidence).toBeLessThan(0.7);
    expect(byId.get('automation:kitchen-dinner-safety')?.summary).toMatch(/stove.*range hood/i);
  }, 60_000);
});
