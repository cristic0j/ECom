"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useMoney } from "@/lib/use-money";
import { parseMoneyToMinor } from "@/lib/utils";

/** Variant row as edited in the form: money kept as strings until save. */
export type VariantRow = {
  key: string;
  id?: string;
  sku: string;
  title: string;
  price: string;
  compareAt: string;
  options: Record<string, string>;
  isDefault: boolean;
  inStock: boolean;
  /** What the store pays the supplier */
  cost: string;
  /** Set for options imported from AliExpress; kept through renames */
  supplierSkuId?: string | null;
};

export type OptionDef = { name: string; values: string };

let seq = 0;
export const newRowKey = () => `row-${++seq}`;

const parseValues = (s: string) => [...new Set(s.split(",").map((v) => v.trim()).filter(Boolean))];

/** Cartesian product of option values, e.g. size×color. */
function combinations(options: OptionDef[]): Record<string, string>[] {
  const defs = options.map((o) => ({ name: o.name.trim(), values: parseValues(o.values) })).filter((o) => o.name && o.values.length);
  return defs.reduce<Record<string, string>[]>(
    (acc, { name, values }) => acc.flatMap((combo) => values.map((v) => ({ ...combo, [name]: v }))),
    [{}],
  );
}

const sameOptions = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

/**
 * Regenerates variant rows from option definitions, reusing existing rows (id, sku, price)
 * whose option values match so edits and ids survive.
 */
export function generateVariants(options: OptionDef[], current: VariantRow[], skuBase: string): VariantRow[] {
  const combos = combinations(options);
  const fallbackPrice = current[0]?.price ?? "";
  const rows = combos.map((opts) => {
    const existing = current.find((r) => sameOptions(r.options, opts));
    if (existing) return existing;
    const suffix = Object.values(opts).map((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, "")).join("-");
    return {
      key: newRowKey(),
      sku: [skuBase.toUpperCase(), suffix].filter(Boolean).join("-"),
      title: Object.values(opts).join(" / "),
      price: fallbackPrice,
      compareAt: "",
      options: opts,
      isDefault: false,
      inStock: true,
      cost: current[0]?.cost ?? "",
    };
  });
  if (rows.length && !rows.some((r) => r.isDefault)) rows[0] = { ...rows[0], isDefault: true };
  return rows;
}

export function optionsFromVariants(rows: VariantRow[]): OptionDef[] {
  const map = new Map<string, string[]>();
  for (const r of rows)
    for (const [k, v] of Object.entries(r.options)) {
      const vals = map.get(k) ?? [];
      if (!vals.includes(v)) vals.push(v);
      map.set(k, vals);
    }
  return [...map.entries()].map(([name, values]) => ({ name, values: values.join(", ") }));
}

export function VariantsEditor({
  options,
  onOptionsChange,
  rows,
  onRowsChange,
  onGenerate,
  errors,
  supplierName,
}: {
  options: OptionDef[];
  onOptionsChange: (o: OptionDef[]) => void;
  rows: VariantRow[];
  onRowsChange: (r: VariantRow[]) => void;
  onGenerate: () => void;
  errors: Record<number, string>;
  /** For imported products: options without a supplier link are flagged, since they can't be ordered there */
  supplierName?: string;
}) {
  const { format } = useMoney();
  const hasOptions = options.length > 0;
  const profit = (r: VariantRow) => {
    const price = parseMoneyToMinor(r.price);
    const cost = r.cost.trim() ? parseMoneyToMinor(r.cost) : NaN;
    return Number.isNaN(price) || Number.isNaN(cost) ? null : price - cost;
  };
  const updateRow = (i: number, patch: Partial<VariantRow>) =>
    onRowsChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : patch.isDefault ? { ...r, isDefault: false } : r)));
  const updateOption = (i: number, patch: Partial<OptionDef>) =>
    onOptionsChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Options</h3>
          <Button size="sm" variant="secondary" onClick={() => onOptionsChange([...options, { name: "", values: "" }])}>
            <Plus className="size-4" /> Add option
          </Button>
        </div>
        {!hasOptions && (
          <p className="text-sm text-muted-foreground">
            No options — this product has a single variant. Add options like Size or Color to sell multiple variants.
          </p>
        )}
        {options.map((o, i) => (
          <div key={i} className="flex gap-2">
            <Input
              aria-label={`Option ${i + 1} name`}
              placeholder="Name (e.g. Size)"
              value={o.name}
              onChange={(e) => updateOption(i, { name: e.target.value })}
              className="w-40"
            />
            <Input
              aria-label={`Option ${i + 1} values`}
              placeholder="Values, comma separated (e.g. S, M, L)"
              value={o.values}
              onChange={(e) => updateOption(i, { values: e.target.value })}
            />
            <Button
              variant="ghost"
              aria-label={`Remove option ${i + 1}`}
              onClick={() => onOptionsChange(options.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {hasOptions && (
          <Button size="sm" onClick={onGenerate}>
            Generate variants
          </Button>
        )}
      </div>

      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left whitespace-nowrap text-muted-foreground">
            <tr>
              <th className="py-2 pr-2 font-medium">Default</th>
              {hasOptions && <th className="py-2 pr-2 font-medium">Variant</th>}
              <th className="py-2 pr-2 font-medium">SKU</th>
              <th className="py-2 pr-2 font-medium">Price</th>
              <th className="py-2 pr-2 font-medium">Compare at</th>
              <th className="py-2 pr-2 font-medium">Cost</th>
              <th className="py-2 pr-2 text-center font-medium">In stock</th>
              {hasOptions && (
                <th className="py-2 font-medium">
                  <span className="sr-only">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="align-top">
                <td className="py-1.5 pr-2">
                  <div className="flex h-10 items-center">
                    <input
                      type="radio"
                      name="default-variant"
                      aria-label={`Make ${r.title} the default variant`}
                      checked={r.isDefault}
                      onChange={() => updateRow(i, { isDefault: true })}
                    />
                  </div>
                </td>
                {hasOptions && (
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <div className="flex h-10 items-center">{r.title}</div>
                  </td>
                )}
                <td className="py-1.5 pr-2">
                  <Input
                    aria-label={`SKU for ${r.title}`}
                    value={r.sku}
                    onChange={(e) => updateRow(i, { sku: e.target.value })}
                    className="min-w-32"
                  />
                  {errors[i] && <p className="mt-1 text-xs text-red-600">{errors[i]}</p>}
                  {supplierName && !r.supplierSkuId && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Not linked to {supplierName}</p>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  <Input
                    aria-label={`Price for ${r.title}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={r.price}
                    onChange={(e) => updateRow(i, { price: e.target.value })}
                    className="w-28"
                  />
                  {profit(r) !== null && (
                    <p className={`mt-1 text-xs ${profit(r)! < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                      {profit(r)! < 0 ? "Loss" : "Profit"} {format(Math.abs(profit(r)!))}
                    </p>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  <Input
                    aria-label={`Compare-at price for ${r.title}`}
                    inputMode="decimal"
                    placeholder="—"
                    value={r.compareAt}
                    onChange={(e) => updateRow(i, { compareAt: e.target.value })}
                    className="w-28"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Input
                    aria-label={`Cost for ${r.title}`}
                    inputMode="decimal"
                    placeholder="—"
                    value={r.cost}
                    onChange={(e) => updateRow(i, { cost: e.target.value })}
                    className="w-24"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <div className="flex h-10 items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={`${r.title} is in stock`}
                      checked={r.inStock}
                      onChange={(e) => updateRow(i, { inStock: e.target.checked })}
                    />
                  </div>
                </td>
                {hasOptions && (
                  <td className="py-1.5">
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${r.title}`}
                      disabled={rows.length === 1}
                      onClick={() => onRowsChange(rows.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Untick &ldquo;In stock&rdquo; when your supplier runs out. Customers can still see the item but can&apos;t buy it.
        Cost is what you pay your supplier; only you see it.
      </p>
    </div>
  );
}
