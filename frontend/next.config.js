/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: '.next',
  outDir: 'out',
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
