import type { ApiError } from '@lumen/core';

export class ApiRequestError extends Error {
  status: number;
  code: string;
  retryAfterSeconds: number | undefined;
  constructor(status: number, body: Partial<ApiError>) {
    super(body.message ?? 'Wystąpił nieoczekiwany błąd.');
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.error ?? 'unknown';
    this.retryAfterSeconds = body.retryAfterSeconds;
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Brak połączenia z serwerem Lumen.');
    this.name = 'NetworkError';
  }
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : null,
      cache: 'no-store',
    });
  } catch {
    throw new NetworkError();
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) throw new ApiRequestError(res.status, data as Partial<ApiError>);
  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError || error instanceof NetworkError) return error.message;
  return 'Wystąpił nieoczekiwany błąd.';
}
