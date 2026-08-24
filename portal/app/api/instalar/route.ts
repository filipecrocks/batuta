import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Serves `script/instalar.sh` at https://batuta.space/instalar.sh.
 *
 * The file served is THE SAME ONE that is versioned in the repository — there is no
 * "production" copy that someone could edit without going through git. In a project
 * that asks people to run `curl | sh`, that's the difference between trust and
 * asking for trust.
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
