'use client';

// Sharing a plan.
//
// Two things travel: a link, and a picture. The link is what people click; the
// picture is what makes them click. So the sheet shows the picture first, lets
// you pick the shape you need (a post, a story, a square), and only then offers
// the places to put it.
//
// Instagram has no web intent — you cannot hand it a post from a browser — so
// the honest offer there is "save the picture", plus the native share sheet on
// a phone, which does reach Instagram.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { drawShareCard, renderShareCard, type CardFormat, type CardStats } from '@/lib/sharecard';
import type { RenderState } from '@/lib/types';
import { BRAND } from '@/lib/brand-icons';
import { toast } from './Dialog';

export interface ShareInput {
  title: string;
  /** A second plan, for a side-by-side card. */
  versus?: { title: string; stats: CardStats; render: RenderState };
  author?: string | null;
  city: string;
  /** Where the population figures came from, for the footnote. */
  dataSource?: string;
  url: string;
  stats: CardStats;
  render: RenderState;
  /** Sentence used as the post text. */
  summary?: string;
}

const FORMATS: { id: CardFormat; label: string; hint: string }[] = [
  { id: 'landscape', label: 'Beitrag', hint: '1200 × 630 · X, Mastodon, Facebook, LinkedIn' },
  { id: 'portrait', label: 'Hochformat', hint: '1080 × 1350 · Instagram- und Threads-Beitrag' },
  { id: 'story', label: 'Story', hint: '1080 × 1920 · Instagram- und TikTok-Story, bildschirmfüllend' },
  { id: 'square', label: 'Quadrat', hint: '1080 × 1080' },
];

/** Open the share sheet. Resolves when it closes. */
export function openShareSheet(input: ShareInput): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  return new Promise((resolve) => {
    const done = () => {
      root.unmount();
      host.remove();
      resolve();
    };
    root.render(<ShareSheet input={input} onClose={done} />);
  });
}

function ShareSheet({ input, onClose }: { input: ShareInput; onClose: () => void }) {
  const [format, setFormat] = useState<CardFormat>('landscape');
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  const text =
    input.summary ??
    `${input.title}: ${input.stats.newKm.toFixed(1).replace('.', ',')} km neu, ` +
      `Nutzen-Kosten-Verhältnis ${input.stats.bcr.toFixed(2).replace('.', ',')}.`;

  useEffect(() => {
    setShown(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dark = document.documentElement.classList.contains('dark');
    if (canvas.current) {
      drawShareCard(canvas.current, { ...input, format, light: !dark });
    }
  }, [format, input]);

  const makeBlob = useCallback(async () => {
    const dark = document.documentElement.classList.contains('dark');
    return renderShareCard({ ...input, format, light: !dark });
  }, [format, input]);

  const filename = `${slug(input.title)}-${format}.png`;

  const download = async () => {
    setBusy('download');
    try {
      const blob = await makeBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Bild gespeichert');
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(null);
    }
  };

  const copyImage = async () => {
    setBusy('copy');
    try {
      const blob = await makeBlob();
      // Only Chromium-family browsers can put an image on the clipboard.
      const Item = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!Item || !navigator.clipboard?.write) throw new Error('Dieser Browser kann keine Bilder kopieren');
      await navigator.clipboard.write([new Item({ 'image/png': blob })]);
      toast('Bild kopiert');
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(null);
    }
  };

  const nativeShare = async () => {
    setBusy('native');
    try {
      const blob = await makeBlob();
      const file = new File([blob], filename, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: input.title, text, url: input.url });
      } else if (nav.share) {
        await nav.share({ title: input.title, text, url: input.url });
      } else {
        throw new Error('Dieses Gerät hat kein Teilen-Menü');
      }
    } catch (e) {
      const err = e as Error;
      if (err.name !== 'AbortError') toast(err.message, 'warn');
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(input.url);
      toast('Link kopiert');
    } catch {
      toast('Link konnte nicht kopiert werden', 'warn');
    }
  };

  /**
   * Instagram, which takes no link.
   *
   * Every other network here opens a web intent with the text and URL prefilled.
   * Instagram has none — it accepts nothing from a web page — so the only thing
   * that actually works is handing over the picture. On a phone that is the
   * share menu, with Instagram in it; on a desktop it is saving the file and
   * posting it from the phone afterwards. Anything else would be a button that
   * pretends.
   */
  const toInstagram = async () => {
    if (format === 'landscape') setFormat('story');
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const probe = new File([new Blob()], 'p.png', { type: 'image/png' });
    if (nav.canShare?.({ files: [probe] })) {
      await nativeShare();
      toast('Im Teilen-Menü Instagram wählen');
    } else {
      await download();
      toast('Bild gespeichert. Bei Instagram als Beitrag oder Story hochladen');
    }
  };

  const post = `${text} ${input.url}`;
  const targets: {
    id: string;
    label: string;
    icon: string;
    tint: string;
    href?: string;
    action?: () => void | Promise<void>;
  }[] = [
    {
      id: 'instagram',
      label: 'Instagram',
      icon: 'IG',
      tint: '#C13584',
      action: toInstagram,
    },
    {
      id: 'x',
      label: 'X',
      icon: '𝕏',
      tint: '#000000',
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(input.url)}`,
    },
    {
      id: 'bluesky',
      label: 'Bluesky',
      icon: '🦋',
      tint: '#0a7aff',
      href: `https://bsky.app/intent/compose?text=${encodeURIComponent(post)}`,
    },
    {
      id: 'mastodon',
      label: 'Mastodon',
      icon: '🐘',
      tint: '#6364ff',
      href: `https://mastodonshare.com/?text=${encodeURIComponent(post)}`,
    },
    {
      id: 'facebook',
      label: 'Facebook',
      icon: 'f',
      tint: '#1877f2',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(input.url)}`,
    },
    {
      id: 'linkedin',
      label: 'LinkedIn',
      icon: 'in',
      tint: '#0a66c2',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(input.url)}`,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      icon: '💬',
      tint: '#25d366',
      href: `https://wa.me/?text=${encodeURIComponent(post)}`,
    },
    {
      id: 'reddit',
      label: 'Reddit',
      icon: '👽',
      tint: '#ff4500',
      href: `https://www.reddit.com/submit?url=${encodeURIComponent(input.url)}&title=${encodeURIComponent(input.title)}`,
    },
    {
      id: 'telegram',
      label: 'Telegram',
      icon: '✈️',
      tint: '#229ed9',
      href: `https://t.me/share/url?url=${encodeURIComponent(input.url)}&text=${encodeURIComponent(text)}`,
    },
  ];

  return (
    <div
      className={`fixed inset-0 z-[85] flex items-end justify-center overflow-y-auto p-0 transition-opacity duration-150 sm:items-center sm:p-4 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgb(10 14 20 / 45%)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Entwurf teilen"
        className={`w-full max-w-[640px] rounded-t-3xl border border-line bg-paper p-4 shadow-2xl transition-all duration-200 sm:rounded-2xl ${
          shown ? 'translate-y-0' : 'translate-y-4'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Entwurf teilen</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              Das Bild wird hier im Browser erzeugt, nichts wird dafür hochgeladen.
            </p>
          </div>
          <button onClick={onClose} aria-label="Schließen" className="rounded-lg px-2 py-1 text-muted hover:bg-subtle">
            ✕
          </button>
        </div>

        {/* The preview is bounded by height, not only by width.
            A 1080 × 1920 story at the dialog's full width is over 1100 px tall,
            which pushed the buttons below it off the screen — the last network
            in the row became unreachable. Tall formats now shrink to fit and
            centre themselves; wide ones still fill the width. */}
        <div className="mt-3 grid max-h-[46vh] place-items-center overflow-hidden rounded-xl border border-line bg-subtle">
          <canvas
            ref={canvas}
            className="block max-h-[46vh] w-full object-contain"
            style={{ width: 'auto', maxWidth: '100%' }}
            aria-label="Vorschau des Teilen-Bildes"
          />
        </div>

        <div role="radiogroup" aria-label="Bildformat" className="mt-3 flex gap-1 rounded-xl bg-subtle p-1">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={format === f.id}
              title={f.hint}
              onClick={() => setFormat(f.id)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-all active:scale-[0.97] ${
                format === f.id ? 'bg-paper shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={download} disabled={busy != null}>
            {busy === 'download' ? 'Speichern …' : 'Bild speichern'}
          </button>
          <button className="btn" onClick={nativeShare} disabled={busy != null}>
            {busy === 'native' ? 'Öffne …' : 'Teilen …'}
          </button>
          <button className="btn" onClick={copyImage} disabled={busy != null}>
            Bild kopieren
          </button>
          <button className="btn" onClick={copyLink}>
            Link kopieren
          </button>
        </div>

        <p className="mt-4 text-[12px] font-medium text-muted">Direkt posten</p>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {targets.map((t) => {
            // A link where the network takes one, a button where it does not.
            const Tag = t.href ? 'a' : 'button';
            return (
            <Tag
              key={t.id}
              {...(t.href
                ? { href: t.href, target: '_blank', rel: 'noreferrer noopener' }
                : { type: 'button' as const, onClick: t.action, disabled: busy != null })}
              title={t.href ? `Auf ${t.label} teilen` : `Bild für ${t.label} vorbereiten`}
              className="flex flex-col items-center gap-1 rounded-xl px-1 py-2 transition-all hover:bg-subtle active:scale-90 disabled:opacity-50"
            >
              <span
                aria-hidden
                className="grid h-9 w-9 place-items-center rounded-full text-[13px] font-bold text-white"
                style={{ background: BRAND[t.id]?.hex ?? t.tint }}
              >
                {/* The real mark where there is one. The letters that stood
                    here before were approximations — "f", "in", an emoji
                    butterfly for Bluesky — and read as placeholders, because
                    that is what they were. */}
                {BRAND[t.id] ? (
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" role="presentation">
                    <path d={BRAND[t.id].path} />
                  </svg>
                ) : (
                  t.icon
                )}
              </span>
              <span className="text-[10.5px] text-muted">{t.label}</span>
            </Tag>
            );
          })}
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-muted">
          Instagram und Threads nehmen keine Beiträge aus dem Browser entgegen. Der Instagram-Knopf oben
          bereitet deshalb das Bild vor: auf dem Handy landet es im Teilen-Menü, am Rechner im Download.
        </p>
      </div>
    </div>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'netzentwurf';
