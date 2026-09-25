import type { Metadata } from "next";
import { requireCartFeature } from "@/lib/store";
import { AccountHome } from "@/components/store/account";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export default async function AccountPage() {
  await requireCartFeature();
  return <AccountHome />;
}
