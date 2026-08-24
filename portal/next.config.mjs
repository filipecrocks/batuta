/** @type {import('next').NextConfig} */
const nextConfig = {
  // O portal e estatico-primeiro por decisao de arquitetura (§4.5, §11 do dossie):
  // ranking e receita sao paginas geradas, servidas por CDN. Sem banco quente no
  // caminho de quem le. O banco existe para a ingestao e para o lote que regenera.
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:caminho*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  async rewrites() {
    // curl -fsSL https://batuta.space/instalar.sh | sh
    return [{ source: "/instalar.sh", destination: "/api/instalar" }];
  },
};
export default nextConfig;
