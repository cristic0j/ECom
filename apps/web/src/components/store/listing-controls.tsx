"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";

const SORTS = [
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["title", "Name"],
] as const;

export function ListingControls() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [min, setMin] = useState(params.get("min") ?? "");
  const [max, setMax] = useState(params.get("max") ?? "");

  const push = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page"); // any filter change resets pagination
    router.push(`${pathname}?${next}`);
  };

  const applyPrice = (e: FormEvent) => {
    e.preventDefault();
    push({ min, max });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form onSubmit={applyPrice} className="flex items-center gap-2" aria-label="Price filter">
        <Input
          aria-label="Minimum price"
          inputMode="decimal"
          placeholder="Min"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          className="w-20"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          aria-label="Maximum price"
          inputMode="decimal"
          placeholder="Max"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          className="w-20"
        />
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
      </form>
      <Select
        aria-label="Sort by"
        value={params.get("sort") ?? "newest"}
        onChange={(e) => push({ sort: e.target.value === "newest" ? "" : e.target.value })}
        className="w-auto"
      >
        {SORTS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </div>
  );
}
