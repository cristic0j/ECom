"use client";

import type { ApiError } from "@ecom/shared";

// Same-origin: next.config.ts proxies /api/* to the Nest API, so the auth cookie is first-party
const API_URL = "/api";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError | null,
  ) {
    super(body?.message ?? `Request failed (${status})`);
  }

  /** zod field errors from a 400 "Validation failed" response, keyed by field path. */
  get fieldErrors(): Record<string, string[]> {
    const details = this.body?.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return details?.fieldErrors ?? {};
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, body);
  return body as T;
}

export const json = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
});

export function toQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}
