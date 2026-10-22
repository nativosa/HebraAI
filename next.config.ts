import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Do not let `next dev` write AGENTS.md when it detects an AI coding agent.
  agentRules: false,
};

export default nextConfig;
