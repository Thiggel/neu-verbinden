'use client';

// "Something is wrong" and "it should do this", in as few steps as the thought
// deserves: pick which of the two it is, write it, send.
//
// No address is asked for. The service works without one everywhere else, and a
// bug report is not the place to start collecting them; there is a field for
// anyone who wants an answer, and it is plainly optional.
//
// The spam defence is a proof of work rather than a captcha. The browser hashes
// until it finds a nonce whose digest begins with enough zero bits — about a
// second of the sender's processor, no clicking, no third party told who is
// writing, nothing to read out of a distorted picture. It runs in a worker, so
// the window stays responsive while it happens.

import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { API_BASE } from '@/lib/api';

type Kind = 'fehler' | 'wunsch' | 'sonstiges';

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'fehler', label: 'Etwas ist kaputt', hint: 'Was hast du gemacht, was ist passiert?' },
  { id: 'wunsch', label: 'Etwas fehlt', hint: 'Was soll die App können?' },
  { id: 'sonstiges', label: 'Etwas anderes', hint: 'Alles, was sonst nicht passt.' },
];

/**
 * The work the server asks for, done off the main thread.
 *
 * Written into a Blob worker rather than a file: it is fifteen lines, it has no
 * imports, and a separate entry point in the build for fifteen lines would be
 * harder to find than this.
 */
function solve(challenge: string, difficulty: number, onProgress: (n: number) => void) {
  const source = `
    self.onmessage = async (e) => {
      const { challenge, difficulty } = e.data;
      const enc = new TextEncoder();
      const need = difficulty;
      for (let n = 0; ; n++) {
        const digest = new Uint8Array(
          await crypto.subtle.digest('SHA-256', enc.encode(challenge + n))
        );
        let bits = 0;
        for (const b of digest) {
          bits += Math.clz32(b) - 24;
          if (b !== 0) break;
        }
        if (bits >= need) { self.postMessage({ nonce: String(n) }); return; }
        if (n % 20000 === 0 && n > 0) self.postMessage({ tried: n });
      }
    };
  `;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const done = new Promise<string>((resolve, reject) => {
    worker.onmessage = (e) => {
      if (e.data.nonce !== undefined) resolve(e.data.nonce);
      else onProgress(e.data.tried);
    };
    worker.onerror = () => reject(new Error('Die Prüfaufgabe ließ sich nicht rechnen.'));
  });
  worker.postMessage({ challenge, difficulty });
  return {
    done: done.finally(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
    }),
    cancel: () => worker.terminate(),
  };
}

function FeedbackDialog({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<Kind>('fehler');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [state, setState] = useState<'schreiben' | 'sendet' | 'fertig'>('schreiben');
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const send = async () => {
    setState('sendet');
    setError(null);
    try {
      const c = await fetch(`${API_BASE}/api/feedback/challenge`).then((r) => {
        if (!r.ok) throw new Error('Der Server ist gerade nicht erreichbar.');
        return r.json();
      });
      const { done } = solve(c.challenge, c.difficulty, () => {});
      const nonce = await done;
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind,
          message,
          replyTo: replyTo || null,
          page: typeof window === 'undefined' ? '' : window.location.pathname,
          challenge: c.challenge,
          signature: c.signature,
          nonce,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Fehler ${res.status}`);
      }
      setState('fertig');
      setTimeout(onDone, 2200);
    } catch (e) {
      setError((e as Error).message);
      setState('schreiben');
    }
  };

  const hint = KINDS.find((k) => k.id === kind)!.hint;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onDone()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Rückmeldung geben"
        className="w-full max-w-[520px] rounded-t-3xl border border-line bg-paper p-4 shadow-2xl sm:rounded-2xl"
      >
        {state === 'fertig' ? (
          <div className="py-6 text-center">
            <div className="text-[28px]">✓</div>
            <h2 className="mt-2 text-[16px] font-semibold">Angekommen. Danke.</h2>
            <p className="mt-1 text-[13.5px] text-muted">
              {replyTo ? 'Du hörst von mir.' : 'Ich lese jede Meldung.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold">Rückmeldung</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  Geht direkt an mich. Ohne Konto, ohne Adresse, ohne Google.
                </p>
              </div>
              <button
                onClick={onDone}
                aria-label="Schließen"
                className="rounded-lg px-2 py-1 text-muted hover:bg-subtle"
              >
                ✕
              </button>
            </div>

            <div
              role="radiogroup"
              aria-label="Worum geht es?"
              className="mt-3 flex gap-1 rounded-xl bg-subtle p-1"
            >
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  role="radio"
                  aria-checked={kind === k.id}
                  onClick={() => setKind(k.id)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-all ${
                    kind === k.id ? 'bg-paper shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <label className="mt-3 block">
              <span className="sr-only">{hint}</span>
              <textarea
                ref={area}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder={hint}
                className="w-full rounded-xl border border-line bg-surface p-3 text-[14px] leading-relaxed"
              />
            </label>

            <label className="mt-2 block">
              <span className="mb-1 block text-[12px] text-muted">
                E-Mail, falls du eine Antwort möchtest (freiwillig)
              </span>
              <input
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                inputMode="email"
                placeholder="nur wenn du magst"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px]"
              />
            </label>

            {error && (
              <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-[13px]">
                {error}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                className="btn btn-primary flex-1"
                disabled={[...message.trim()].length < 5 || state === 'sendet'}
                onClick={send}
              >
                {state === 'sendet' ? 'Wird geprüft und gesendet …' : 'Absenden'}
              </button>
              <button className="btn" onClick={onDone}>
                Abbrechen
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">
              Statt eines Captchas rechnet dein Browser kurz eine Aufgabe. Das dauert etwa eine
              Sekunde, kostet dich keinen Klick und verrät niemandem, wer du bist.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Opens the feedback sheet. Mounted on demand, like the other sheets. */
export function openFeedback(): void {
  if (typeof document === 'undefined') return;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const done = () => {
    root.unmount();
    host.remove();
  };
  root.render(<FeedbackDialog onDone={done} />);
}
