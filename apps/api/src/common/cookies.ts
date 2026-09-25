import { env } from "../config/env";

/** Base options for every auth/session cookie the API sets. */
export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  path: "/",
};

export const DAY_MS = 24 * 60 * 60 * 1000;
