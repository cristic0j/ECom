"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { FolderTree, LayoutDashboard, LogOut, Package, Settings, Store } from "lucide-react";
import type { AdminUserDto } from "@ecom/shared";
import { adminApi, ApiRequestError } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

const AdminContext = createContext<AdminUserDto | null>(null);

/** The signed-in admin. Only usable inside the admin panel. */
export function useAdmin(): AdminUserDto {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error("useAdmin must be used inside <AdminShell>");
  return admin;
}

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/categories", label: "Categories", icon: FolderTree },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminUserDto | null>(null);

  useEffect(() => {
    adminApi
      .me()
      .then(setAdmin)
      .catch((e) => {
        if (e instanceof ApiRequestError && e.status === 401) {
          router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
        }
      });
  }, [router, pathname]);

  const logout = async () => {
    await adminApi.logout().catch(() => {});
    router.replace("/admin/login");
  };

  if (!admin) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  return (
    <AdminContext.Provider value={admin}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="border-b border-border bg-background md:w-60 md:shrink-0 md:border-r md:border-b-0">
          <div className="flex h-16 items-center px-5 font-bold">Admin</div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
            {NAV.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-3 rounded-(--radius) px-3 py-2 text-sm",
                    active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  <Icon className="size-4" /> {label}
                </Link>
              );
            })}
            <Link
              href="/"
              target="_blank"
              className="flex shrink-0 items-center gap-3 rounded-(--radius) px-3 py-2 text-sm hover:bg-muted"
            >
              <Store className="size-4" /> View store
            </Link>
          </nav>
          <div className="hidden border-t border-border p-4 text-sm md:mt-6 md:block">
            <p className="truncate font-medium">{admin.name || admin.email}</p>
            <p className="text-xs text-muted-foreground">{admin.role}</p>
            <button onClick={logout} className="mt-3 flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </aside>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
