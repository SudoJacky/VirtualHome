import { describe, expect, it } from 'vitest';
import { createCameraAutoFrameState, getRoomVisualTreatment, updateCameraAutoFrameState } from '../src/web/Floorplan3D';

describe('3D floorplan camera control', () => {
  it('pauses automatic framing after manual camera control until the focus target changes', () => {
    let state = createCameraAutoFrameState('device:water_valve_01');

    expect(state.autoFrame).toBe(true);

    state = updateCameraAutoFrameState(state, { type: 'manual-control-started' });
    expect(state.autoFrame).toBe(false);

    state = updateCameraAutoFrameState(state, {
      type: 'focus-target-changed',
      focusKey: 'device:water_valve_01'
    });
    expect(state.autoFrame).toBe(false);

    state = updateCameraAutoFrameState(state, {
      type: 'focus-target-changed',
      focusKey: 'room:kitchen'
    });
    expect(state).toEqual({
      focusKey: 'room:kitchen',
      autoFrame: true
    });
  });

  it('lets reset view opt back into automatic framing', () => {
    const state = updateCameraAutoFrameState(
      { focusKey: 'device:water_valve_01', autoFrame: false },
      { type: 'reset-view' }
    );

    expect(state).toEqual({
      focusKey: 'device:water_valve_01',
      autoFrame: true
    });
  });

  it('does not use a floor wash to show selected rooms', () => {
    const treatment = getRoomVisualTreatment({
      selected: true,
      occupied: false,
      alertSeverity: undefined
    });

    expect(treatment.floorAccentOpacity).toBe(0);
    expect(treatment.wallColor).not.toBe('#1e6fbb');
  });
});
