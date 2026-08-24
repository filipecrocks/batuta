import type { MetadataRoute } from "next";

const ROTAS = [
  "",
  "/manifesto",
  "/spec",
  "/protocolo",
  "/ranking",
  "/receitas",
  "/arena",
  "/registros",
  "/privacidade",
  "/instalar",
  "/creditos",
  "/doar",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROTAS.map((r) => ({
    url: `https://batuta.space${r}`,
    changeFrequency: r === "/ranking" ? "daily" : "weekly",
    priority: r === "" ? 1 : 0.7,
  }));
}
