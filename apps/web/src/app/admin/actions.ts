"use server";

import { cookies } from "next/headers";
import { updateTag } from "next/cache";
import { TAGS } from "@/lib/api";

const API_URL = `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/api`;

/**
 * Called by the admin UI after a successful save so the storefront shows changes immediately.
 * Verifies the caller's admin session against the API before touching the cache.
 */
export async function revalidateStorefront(scope: keyof typeof TAGS = "catalog"): Promise<void> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_URL}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" });
  if (!res.ok) throw new Error("Not authorized");
  updateTag(TAGS[scope]);
}
