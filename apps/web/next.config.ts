import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

// Hosts product images may come from. Add your CDN / S3 bucket host here (or via IMAGE_HOSTS).
const imageHosts = [
  "picsum.photos",
  "fastly.picsum.photos",
  ...(process.env.IMAGE_HOSTS?.split(",").filter(Boolean) ?? []),
];

const nextConfig: NextConfig = {
  // Monorepo root, so store.config.ts and workspace packages resolve
  turbopack: { root: fileURLToPath(new URL("../..", import.meta.url)) },

  // Same-origin API: the browser talks to /api/*, Next forwards to Nest. Keeps the admin cookie first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },

  images: {
    remotePatterns: [
      ...imageHosts.map((hostname) => ({ protocol: "https" as const, hostname })),
      new URL(`${apiUrl}/uploads/**`),
    ],
    // Locally uploaded images are served by the API on localhost, which Next 16 blocks by default
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
  },
};

export default nextConfig;
