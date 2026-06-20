import type { TwinEvent, TwinSnapshot } from '../shared/types';

export interface ApiUpdate {
  snapshot: TwinSnapshot;
  events: TwinEvent[];
}

export class ApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface PostUpdateOptions {
  fetcher?: FetchLike;
  timeoutMs?: number;
  idempotencyKey?: string;
}

export interface GetJsonOptions {
  fetcher?: FetchLike;
  timeoutMs?: number;
}

export type AlertStatusCommand = 'active' | 'acknowledged' | 'resolved' | 'ignored';
export type DeviceCommandValue = string | number | boolean | null;

export function createIdempotencyKey(): string {
  return `cmd_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export async function postUpdate(
  url: string,
  payload: unknown,
  fetcherOrOptions: FetchLike | PostUpdateOptions = fetch,
  timeoutMs = 10000,
  idempotencyKey?: string
): Promise<ApiUpdate> {
  const options = typeof fetcherOrOptions === 'function'
    ? { fetcher: fetcherOrOptions, timeoutMs, idempotencyKey }
    : fetcherOrOptions;
  const fetcher = options.fetcher ?? fetch;
  const requestTimeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withIdempotencyKey(payload, options.idempotencyKey)),
      signal: controller.signal
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new ApiClientError(formatApiError(body, response), response.status);
    }
    return body as ApiUpdate;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getJson<T = unknown>(
  url: string,
  fetcherOrOptions: FetchLike | GetJsonOptions = fetch,
  timeoutMs = 10000
): Promise<T> {
  const options = typeof fetcherOrOptions === 'function'
    ? { fetcher: fetcherOrOptions, timeoutMs }
    : fetcherOrOptions;
  const fetcher = options.fetcher ?? fetch;
  const requestTimeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetcher(url, {
      method: 'GET',
      signal: controller.signal
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new ApiClientError(formatApiError(body, response), response.status);
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function postAlertStatus(
  alertId: string,
  status: AlertStatusCommand,
  options: PostUpdateOptions = {}
): Promise<ApiUpdate> {
  return postUpdate(`/api/alerts/${encodeURIComponent(alertId)}/status`, { status }, options);
}

export async function postDeviceCommand(
  deviceId: string,
  command: string,
  value: DeviceCommandValue = null,
  options: PostUpdateOptions = {}
): Promise<ApiUpdate> {
  return postUpdate(`/api/devices/${encodeURIComponent(deviceId)}/command`, { command, value }, options);
}

function withIdempotencyKey(payload: unknown, idempotencyKey: string | undefined): unknown {
  if (!idempotencyKey) {
    return payload;
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...payload, idempotencyKey };
  }
  return { value: payload, idempotencyKey };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function formatApiError(body: unknown, response: Response): string {
  if (isErrorEnvelope(body)) {
    const issueText = body.error.issues
      ?.map((issue) => [issue.path, issue.message].filter(Boolean).join(' '))
      .filter((item) => item.length > 0)
      .join('; ');
    return issueText ? `${body.error.message}: ${issueText}` : body.error.message;
  }
  if (isStringError(body)) {
    return body.error;
  }
  if (typeof body === 'string' && body.trim()) {
    return body;
  }
  return `Request failed with ${response.status} ${response.statusText || 'HTTP error'}`;
}

function isErrorEnvelope(value: unknown): value is {
  error: {
    message: string;
    issues?: Array<{ path?: string; message?: string }>;
  };
} {
  if (!value || typeof value !== 'object' || !('error' in value)) {
    return false;
  }
  const error = (value as { error?: unknown }).error;
  return Boolean(error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string');
}

function isStringError(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string');
}
