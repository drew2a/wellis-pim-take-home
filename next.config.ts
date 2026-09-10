import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Otherwise `next dev` appends a vendor "agent-rules" block to CLAUDE.md, which is the repo
  // owner's document. Documented opt-out: next/dist/docs/01-app/02-guides/ai-agents.md.
  agentRules: false,
};

export default nextConfig;
