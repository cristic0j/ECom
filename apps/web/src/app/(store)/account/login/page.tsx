import type { Metadata } from "next";
import { requireCartFeature } from "@/lib/store";
import { AuthForm } from "@/components/store/account";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function CustomerLoginPage({ searchParams }: PageProps<"/account/login">) {
  await requireCartFeature();
  const { next } = await searchParams;
  return <AuthForm mode="login" next={typeof next === "string" ? next : undefined} />;
}
