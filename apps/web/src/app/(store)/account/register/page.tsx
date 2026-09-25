import type { Metadata } from "next";
import { requireCartFeature } from "@/lib/store";
import { AuthForm } from "@/components/store/account";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default async function CustomerRegisterPage({ searchParams }: PageProps<"/account/register">) {
  await requireCartFeature();
  const { next } = await searchParams;
  return <AuthForm mode="register" next={typeof next === "string" ? next : undefined} />;
}
