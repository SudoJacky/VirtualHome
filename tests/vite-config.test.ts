import { describe, expect, it } from 'vitest';
import { resolveDevProxyTargets } from '../vite.config';

describe('vite dev proxy configuration', () => {
  it('allows the API and WebSocket backend origin to be overridden for local verification', () => {
    const targets = resolveDevProxyTargets({
      VIRTUALHOME_API_ORIGIN: 'http://127.0.0.1:4327',
      VIRTUALHOME_WS_ORIGIN: 'ws://127.0.0.1:4327'
    });

    expect(targets.api).toBe('http://127.0.0.1:4327');
    expect(targets.ws).toBe('ws://127.0.0.1:4327');
  });
});
