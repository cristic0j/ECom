import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist } from "next/font/google";
import { getStore } from "@/lib/store";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const store = await getStore();
  return {
    metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
    title: { default: store.name, template: `%s | ${store.name}` },
    description: store.tagline,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { theme, locale } = await getStore();
  const themeVars = {
    "--primary": theme.primary,
    "--primary-foreground": theme.primaryForeground,
    "--accent": theme.accent,
    "--radius": theme.radius,
  } as CSSProperties;

  return (
    <html lang={locale.split("-")[0]} style={themeVars}>
      <body className={`${geist.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
