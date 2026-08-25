import { skillRanking } from "@/lib/db";
import { HomeContent } from "@/components/HomeContent";

export const revalidate = 3600;

export default async function Home() {
  const ranking = await skillRanking({ days: 30, limit: 5 });
  return <HomeContent skillsMeasured={ranking.length} />;
}
