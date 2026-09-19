import type { ApiEndpointWithBody } from '@repo/api-client';
export async function serverFetch<T>(
  endpoint: ApiEndpointWithBody<unknown, T>,
): Promise<T> {
  const response = await fetch(
    `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:3011'}${endpoint.url}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Unable to load data');
  return response.json() as Promise<T>;
}
