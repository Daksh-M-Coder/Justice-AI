import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* API routes need the Node runtime (firebase-admin, JSON corpus), which is not
     compatible with cacheComponents - so it is explicitly off. */
  cacheComponents: false,
  
  // Prevent Next.js from inlining / re-bundling firebase-admin and its CJS/ESM dependencies
  serverExternalPackages: ["firebase-admin", "jwks-rsa", "jose"],

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
