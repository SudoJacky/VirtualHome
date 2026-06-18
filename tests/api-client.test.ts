import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, postUpdate } from '../src/web/apiClient';

describe('web API client', () => {
  it('posts JSON updates through the configured endpoint', async () => {
    const update = { snapshot: { runId: 'run_1' }, events: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(update), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(postUpdate('/api/control/advance', { minutes: 15 }, fetchMock)).resolves.toStrictEqual(update);
    expect(fetchMock).toHaveBeenCalledWith('/api/control/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 15 }),
      signal: expect.any(AbortSignal)
    });
  });

  it('attaches an idempotency key to mutating update requests', async () => {
    const update = { snapshot: { runId: 'run_1' }, events: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(update), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    await postUpdate('/api/control/advance', { minutes: 15 }, fetchMock, 10000, 'advance-key');

    expect(fetchMock).toHaveBeenCalledWith('/api/control/advance', expect.objectContaining({
      body: JSON.stringify({ minutes: 15, idempotencyKey: 'advance-key' })
    }));
  });

  it('rejects non-2xx responses with a displayable API error', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
        issues: [{ path: 'minutes', message: 'Too small' }]
      }
    }), {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(postUpdate('/api/control/advance', { minutes: 0 }, fetchMock)).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 400,
      message: 'Invalid request: minutes Too small'
    });
    await expect(postUpdate('/api/control/advance', { minutes: 0 }, fetchMock)).rejects.toBeInstanceOf(ApiClientError);
  });
});
