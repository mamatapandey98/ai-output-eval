import type { NextConfig } from "next";

// This app sits inside the evaluation repo, which has its own lockfile; build from here.
const nextConfig: NextConfig = { turbopack: { root: __dirname } };

export default nextConfig;
