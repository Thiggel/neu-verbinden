// The scenario page is a server component so a shared link carries a proper
// preview: a title, a sentence, and the picture of the network. Everything
// interactive lives in the client component below it.

import type { Metadata } from 'next';
import { ScenarioView } from './ScenarioView';
import { fetchScenario } from './scenario-data';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchScenario(slug);
  if (!data) return { title: 'Entwurf · Verkehrsnetz-Designer' };
  const km = (v: number) => `${v.toFixed(1).replace('.', ',')} km`;
  const eur = (v: number) =>
    Math.abs(v) >= 1e9
      ? `${(v / 1e9).toFixed(1).replace('.', ',')} Mrd. €`
      : `${Math.round(v / 1e6).toLocaleString('de-DE')} Mio. €`;
  const summary =
    data.description?.trim() ||
    `${km(data.new_km)} neue Strecke, ${data.new_stations} neue Stationen, ` +
      `${eur(data.investment_eur)}, Nutzen-Kosten-Verhältnis ` +
      `${data.benefit_cost_ratio.toFixed(2).replace('.', ',')}.`;
  return {
    title: `${data.title} · Verkehrsnetz-Designer`,
    description: summary,
    openGraph: {
      title: data.title,
      description: summary,
      type: 'article',
    },
    twitter: { card: 'summary_large_image', title: data.title, description: summary },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ScenarioView slug={slug} />;
}
