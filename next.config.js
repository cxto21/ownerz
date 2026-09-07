/** @type {import('next').NextConfig} */
const rpcBase =
  process.env.NEXT_PUBLIC_NETWORK === 'SN_MAIN'
    ? 'https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_8'
    : 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/rpc/:path*',
        destination: `${rpcBase}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
