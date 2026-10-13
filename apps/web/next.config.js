/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@repo/shared', '@repo/database'],
  experimental: {
    serverComponentsExternalPackages: ['pg']
  },
  // Workspace packages are consumed as TypeScript source and use NodeNext-style `./x.js` import
  // specifiers; resolve those to the .ts files (they used to resolve to stale committed .js builds).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  }
};

module.exports = nextConfig;
