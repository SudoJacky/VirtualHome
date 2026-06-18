export class SeededRandom {
  private state: number;

  constructor(seed: number, state = seed) {
    this.state = state >>> 0;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  getState(): number {
    return this.state;
  }
}
