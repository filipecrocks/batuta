/** @type {import('next').NextConfig} */
const nextConfig = {
  // The portal is static-first by architectural decision (§4.5, §11 of the dossier):
  // ranking and recipe pages are generated, served by CDN. No hot database in the
  // reader's path. The database exists for ingestion and for the batch that regenerates.
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  async rewrites() {
    // curl -fsSL https://batuta.space/install.sh | sh
    return [{ source: "/install.sh", destination: "/api/install" }];
  },
};
export default nextConfig;
