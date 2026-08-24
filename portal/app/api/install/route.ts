import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Serves `script/install.sh` at https://batuta.space/install.sh.
 *
 * The file served is THE SAME ONE that is versioned in the repository — there is no
 * "production" copy that someone could edit without going through git. In a project
 * that asks people to run `curl | sh`, that's the difference between trust and
 * asking for trust.
 */
export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET() {
  let body: string;
  try {
    body = readFileSync(join(process.cwd(), "public", "install.sh"), "utf8");
  } catch {
    return new Response(
      "# installer unavailable in this build\nexit 1\n",
      { status: 503, headers: { "content-type": "text/x-shellscript; charset=utf-8" } },
    );
  }
  return new Response(body, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
