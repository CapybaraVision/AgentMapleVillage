export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export async function getJson<T>(url: string, token?: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { method: 'GET', headers });
  const parsed = (await response.json()) as { ok?: boolean; error?: string; message?: string };
  if (!response.ok || parsed.ok === false) {
    throw new HttpError(response.status, parsed.error ?? 'http_error', parsed.message ?? response.statusText, parsed);
  }
  return parsed as T;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  token?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const parsed = (await response.json()) as { ok?: boolean; error?: string; message?: string };
  if (!response.ok || parsed.ok === false) {
    throw new HttpError(response.status, parsed.error ?? 'http_error', parsed.message ?? response.statusText, parsed);
  }
  return parsed as T;
}
