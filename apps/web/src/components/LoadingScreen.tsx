import type { CityEntry } from '@/lib/engine';
import { NetworkMark } from '@/components/NetworkMark';

export function LoadingScreen({
  stage,
  fraction,
  city,
}: {
  stage: string;
  fraction: number;
  /** Known from the manifest on, which arrives well before the datasets. */
  city?: CityEntry | null;
}) {
  return (
    <main className="grid h-full grid-cols-1 place-items-center bg-paper p-8">
      <div className="w-full max-w-sm text-center">
        <div className="mb-5 flex justify-center">
          <NetworkMark size={80} />
        </div>
        <h1 className="text-[17px] font-semibold">{city?.name ? `${city.name} neu verbinden` : 'Neu verbinden'}</h1>
        <p className="mt-1 text-[13px] text-muted">{stage} …</p>
        <div className="mx-auto mt-4 h-1 w-56 overflow-hidden rounded-full bg-subtle">
          <div
            className="h-full rounded-full bg-ink transition-[width] duration-300"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
        <p className="mt-6 text-[11px] leading-relaxed text-muted">
          Netzdaten aus OpenStreetMap. Einwohner- und Beschäftigtendaten:{' '}
          {city?.statistics?.label ?? 'offene Statistikdaten'}. Alle Kosten- und Nutzenangaben sind
          Modellschätzungen.
        </p>
      </div>
    </main>
  );
}
