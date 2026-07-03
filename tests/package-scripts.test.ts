import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('package scripts', () => {
  it('defines one local verification command for the required gates', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.verify).toBe('npm run typecheck && npm test && npm run build');
  });

  it('defines a local long-horizon evaluation command', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.evaluate).toBe('tsx src/sim/evaluation/runEvaluation.ts');
  });

  it('defines a local training dataset export command', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.dataset).toBe('tsx src/sim/evaluation/runEvaluation.ts --dataset');
  });

  it('defines a Home Memory device-event dataset export command', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['memory:dataset']).toBe('tsx src/sim/evaluation/homeMemoryDataset.ts');
  });
});
