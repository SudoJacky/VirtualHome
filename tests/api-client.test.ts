import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, getJson, postAlertStatus, postDeviceCommand, postUpdate } from '../src/web/apiClient';

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

  it('posts alert lifecycle status changes through the alert endpoint', async () => {
    const update = { snapshot: { runId: 'run_1' }, events: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(update), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(postAlertStatus('fridge alert/1', 'acknowledged', { fetcher: fetchMock, idempotencyKey: 'alert-key' })).resolves.toStrictEqual(update);

    expect(fetchMock).toHaveBeenCalledWith('/api/alerts/fridge%20alert%2F1/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'acknowledged', idempotencyKey: 'alert-key' }),
      signal: expect.any(AbortSignal)
    });
  });

  it('posts simulated device commands through the encoded device endpoint', async () => {
    const update = { snapshot: { runId: 'run_1' }, events: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(update), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(postDeviceCommand('living light/1', 'set_brightness', 62, { fetcher: fetchMock, idempotencyKey: 'device-key' })).resolves.toStrictEqual(update);

    expect(fetchMock).toHaveBeenCalledWith('/api/devices/living%20light%2F1/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'set_brightness', value: 62, idempotencyKey: 'device-key' }),
      signal: expect.any(AbortSignal)
    });
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

  it('rejects non-2xx JSON reads with the same API error type', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid query',
        issues: [{ path: 'limit', message: 'Too large' }]
      }
    }), {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(getJson('/api/events?limit=10000', fetchMock)).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 400,
      message: 'Invalid query: limit Too large'
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/events?limit=10000', {
      method: 'GET',
      signal: expect.any(AbortSignal)
    });
  });
});
