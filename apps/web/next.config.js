/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@repo/shared', '@repo/database'],
  experimental: {
    serverComponentsExternalPackages: ['pg']
  }
};

module.exports = nextConfig;
