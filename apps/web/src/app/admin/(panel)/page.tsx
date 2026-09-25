"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { adminApi } from "@/lib/admin-api";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { PageHeader, useAdmin } from "@/components/admin/admin-shell";

type Stats = { active: number; draft: number; archived: number; categories: number };

export default function DashboardPage() {
  const admin = useAdmin();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const count = (status: "ACTIVE" | "DRAFT" | "ARCHIVED") =>
      adminApi.listProducts({ status, pageSize: 1 }).then((r) => r.total);
    Promise.all([count("ACTIVE"), count("DRAFT"), count("ARCHIVED"), adminApi.listCategories()]).then(
      ([active, draft, archived, cats]) => setStats({ active, draft, archived, categories: cats.length }),
    );
  }, []);

  const tiles: [string, number | undefined, string][] = [
    ["Active products", stats?.active, "/admin/products?status=ACTIVE"],
    ["Drafts", stats?.draft, "/admin/products?status=DRAFT"],
    ["Archived", stats?.archived, "/admin/products?status=ARCHIVED"],
    ["Categories", stats?.categories, "/admin/categories"],
  ];

  return (
    <>
      <PageHeader
        title={`Welcome${admin.name ? `, ${admin.name}` : ""}`}
        actions={
          <Link href="/admin/products/new" className={buttonClass()}>
            <Plus className="size-4" /> New product
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([label, value, href]) => (
          <Link key={label} href={href}>
            <Card className="transition hover:border-primary">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{value ?? "–"}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
