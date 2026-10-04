import { BadRequestException } from "@nestjs/common";

/** Accepts the full address AliExpress redirected to, or just the code. */
export function parseAuthorizationInput(input: string): { code: string; state?: string } {
  const text = input.trim();
  if (!text.includes("code=")) return { code: text };
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : text;
  const params = new URLSearchParams(query.split("#")[0]);
  const code = params.get("code");
  if (!code) throw new BadRequestException("That address has no authorization code in it");
  return { code, state: params.get("state") ?? undefined };
}
