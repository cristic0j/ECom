import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "19.99" → 1999. Returns NaN for invalid input. */
export function parseMoneyToMinor(value: string): number {
  if (!/^\d+([.,]\d{1,2})?$/.test(value.trim())) return NaN;
  return Math.round(Number(value.trim().replace(",", ".")) * 100);
}

export function minorToInput(minor: number | null | undefined): string {
  return minor == null ? "" : (minor / 100).toFixed(2);
}
