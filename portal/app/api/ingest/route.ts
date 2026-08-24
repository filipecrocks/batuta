/** Compatibility path for clients that predate `/api/ingest/daily`. */
export { GET, POST } from "./daily/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
