/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/rpc/:path*',
        destination: 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
