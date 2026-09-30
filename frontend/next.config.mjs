/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow images from Islamic CDNs (audio thumbnails etc.)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.islamic.network",
      },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ['@remotion/bundler', '@remotion/renderer', '@remotion/media-utils', 'remotion'],
  },
  async rewrites() {
    return [
      // Only the read-only surah endpoints the browser actually calls
      // (VideoCreatorForm) -- extraction/cleanup/AI stay reachable only
      // server-side via INTERNAL_API_URL, never from the public internet.
      {
        source: '/backend/surahs',
        destination: 'http://backend:8000/api/surahs',
      },
      {
        source: '/backend/surahs/:path*',
        destination: 'http://backend:8000/api/surahs/:path*',
      },
    ];
  },
};

export default nextConfig;
