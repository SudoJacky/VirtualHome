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

export async function postUpdate(url: string, payload: unknown, fetcher: FetchLike = fetch, timeoutMs = 10000): Promise<ApiUpdate> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
