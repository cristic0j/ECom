import { AdminShell } from "@/components/admin/admin-shell";

export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
