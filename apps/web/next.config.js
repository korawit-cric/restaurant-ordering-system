const nextConfig = {
  async headers() {
    return [
      {
        source: '/staff/reset-password',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
      {
        source: '/staff/accept-invite',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:3011'}/:path*`,
      },
    ];
  },
};
export default nextConfig;
