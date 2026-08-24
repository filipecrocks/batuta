import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Serve `script/instalar.sh` em https://batuta.space/instalar.sh.
 *
 * O arquivo servido é O MESMO que está versionado no repositório — não existe uma
 * cópia "de produção" que alguém possa editar sem passar pelo git. Num projeto que
 * pede para as pessoas rodarem `curl | sh`, essa é a diferença entre confiança e
 * pedido de confiança.
 */
export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET() {
  let corpo: string;
  try {
    corpo = readFileSync(join(process.cwd(), "public", "instalar.sh"), "utf8");
  } catch {
    return new Response(
      "# instalador indisponível neste build\nexit 1\n",
      { status: 503, headers: { "content-type": "text/x-shellscript; charset=utf-8" } },
    );
  }
  return new Response(corpo, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
