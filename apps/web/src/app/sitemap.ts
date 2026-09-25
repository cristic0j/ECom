import type { MetadataRoute } from "next";
import { api } from "@/lib/api";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([
    api.productSlugs().catch(() => []),
    api.categories().catch(() => []),
  ]);
  const flatten = (cs: typeof categories): typeof categories => cs.flatMap((c) => [c, ...flatten(c.children ?? [])]);

  return [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    ...flatten(categories).map((c) => ({ url: `${SITE_URL}/c/${c.slug}`, changeFrequency: "weekly" as const })),
    ...products.map((p) => ({ url: `${SITE_URL}/p/${p.slug}`, lastModified: p.updatedAt })),
  ];
}
