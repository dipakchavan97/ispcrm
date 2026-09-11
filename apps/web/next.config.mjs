/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@isp-crm/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
