import type { Metadata } from "next";
import { requireCartFeature } from "@/lib/store";
import { ForgotPasswordForm } from "@/components/store/account";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default async function ForgotPasswordPage() {
  await requireCartFeature();
  return <ForgotPasswordForm />;
}
