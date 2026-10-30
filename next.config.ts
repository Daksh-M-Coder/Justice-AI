import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* API routes need the Node runtime (firebase-admin, JSON corpus), which is not
     compatible with cacheComponents - so it is explicitly off. */
  cacheComponents: false,
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
