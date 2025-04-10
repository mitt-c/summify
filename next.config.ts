import type { NextConfig } from "next";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const nextConfig: NextConfig = {
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  },
};

export default nextConfig;
