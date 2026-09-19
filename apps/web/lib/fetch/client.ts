import type { ApiEndpointWithBody } from '@repo/api-client';
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function clientFetch<T>(
  endpoint: ApiEndpointWithBody<unknown, T>,
): Promise<T> {
  const response = await fetch(`/api${endpoint.url}`, {
    method: endpoint.method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body:
      endpoint.body === undefined ? undefined : JSON.stringify(endpoint.body),
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ message: 'Connection failed. Please try again.' }))) as {
      message?: unknown;
    };
    throw new ApiError(
      typeof body.message === 'string'
        ? body.message
        : 'The request could not be completed.',
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
