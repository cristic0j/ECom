import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCartFeature } from "@/lib/store";
import { ResetPasswordForm } from "@/components/store/account";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false },
  // Keep the token out of Referer headers sent to other sites
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({ searchParams }: PageProps<"/account/reset-password">) {
  await requireCartFeature();
  const { token } = await searchParams;
  if (typeof token !== "string" || !token) notFound();
  return <ResetPasswordForm token={token} />;
}
