import { describe, expect, it } from 'vitest';
import { rulerStep } from './Rulers';

describe('ruler ticks', () => {
  it('labels ticks at least 50 screen px apart, with finer ticks in between', () => {
    expect(rulerStep(1)).toEqual({ step: 50, minor: 5 });
    expect(rulerStep(0.25)).toEqual({ step: 200, minor: 20 });
    expect(rulerStep(8)).toEqual({ step: 10, minor: 1 });
    expect(rulerStep(32)).toEqual({ step: 2, minor: 0.2 });
    // Very small zoom still finds a step.
    expect(rulerStep(0.0625).step).toBe(1000);
  });
});
