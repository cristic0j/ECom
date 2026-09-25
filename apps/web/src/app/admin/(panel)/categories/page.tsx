"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { CategoryDto, CategoryInput } from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { slugify } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/misc";
import { PageHeader, useAdmin } from "@/components/admin/admin-shell";
import { revalidateStorefront } from "../../actions";

const empty = { name: "", slug: "", parentId: "", sortOrder: "0" };

/** Flat list ordered as a tree (parents followed by their children) with depth for indentation. */
function orderAsTree(cats: CategoryDto[]): (CategoryDto & { depth: number })[] {
  const out: (CategoryDto & { depth: number })[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of cats.filter((x) => x.parentId === parentId)) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default function CategoriesPage() {
  const admin = useAdmin();
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi.listCategories().then(setCategories).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const reset = () => {
    setForm(empty);
    setEditingId(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const input: CategoryInput = {
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name),
      parentId: form.parentId || null,
      sortOrder: Number(form.sortOrder) || 0,
    };
    try {
      if (editingId) await adminApi.updateCategory(editingId, input);
      else await adminApi.createCategory(input);
      await revalidateStorefront();
      reset();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const edit = (c: CategoryDto) => {
    setEditingId(c.id);
    setForm({ name: c.name, slug: c.slug, parentId: c.parentId ?? "", sortOrder: String(c.sortOrder) });
  };

  const remove = async (c: CategoryDto) => {
    if (!confirm(`Delete "${c.name}"? Sub-categories move to the top level; products stay but lose this category.`)) return;
    try {
      await adminApi.deleteCategory(c.id);
      await revalidateStorefront();
      if (editingId === c.id) reset();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const tree = orderAsTree(categories);

  return (
    <>
      <PageHeader title="Categories" />
      {error && <Alert className="mb-4">{error}</Alert>}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="p-0">
          {tree.length === 0 ? (
            <p className="p-6 text-muted-foreground">No categories yet.</p>
          ) : (
            <ul>
              {tree.map((c) => (
                <li key={c.id} className="flex items-center gap-2 border-b border-border px-4 py-3 last:border-0">
                  <span style={{ paddingLeft: c.depth * 20 }} className="flex-1">
                    <span className="font-medium">{c.name}</span>{" "}
                    <span className="text-sm text-muted-foreground">/{c.slug}</span>
                  </span>
                  <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => edit(c)}>
                    <Pencil className="size-4" />
                  </Button>
                  {admin.role === "ADMIN" && (
                    <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => remove(c)}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <form onSubmit={onSubmit} className="space-y-4">
            <h2 className="font-semibold">{editingId ? "Edit category" : "New category"}</h2>
            <Field label="Name" htmlFor="cat-name">
              <Input
                id="cat-name"
                required
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value, slug: editingId ? f.slug : slugify(e.target.value) }))
                }
              />
            </Field>
            <Field label="Slug" htmlFor="cat-slug" hint={`/c/${form.slug || "…"}`}>
              <Input id="cat-slug" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
            </Field>
            <Field label="Parent" htmlFor="cat-parent">
              <Select
                id="cat-parent"
                value={form.parentId}
                onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
              >
                <option value="">— None (top level) —</option>
                {tree
                  .filter((c) => c.id !== editingId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {"— ".repeat(c.depth)}
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Sort order" htmlFor="cat-sort" hint="Lower numbers appear first">
              <Input
                id="cat-sort"
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit">{editingId ? "Save changes" : "Create category"}</Button>
              {editingId && (
                <Button variant="secondary" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
