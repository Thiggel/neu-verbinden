'use client';

// "Something is wrong" and "it should do this", in as few steps as the thought
// deserves: pick which of the two it is, write it, send.
//
// No address is asked for. The service works without one everywhere else, and a
// bug report is not the place to start collecting them; there is a field for
// anyone who wants an answer, and it is plainly optional.
//
// The message goes to Web3Forms, which forwards it by mail, so that the
// operator's address appears nowhere in the page or in the source code, where
// harvesters would find it. The access key is public by design, since it only
// lets a form deliver to the one inbox it was created for, and a build can
// replace it with NEXT_PUBLIC_WEB3FORMS_KEY.
//
// The spam defence asks nothing of a person: a hidden checkbox that only a bot
// ticks, a few seconds that have to pass between opening the window and
// sending, a minute between two messages from the same browser and an upper
// bound on the length.

import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Kind = 'fehler' | 'wunsch' | 'sonstiges';

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'fehler', label: 'Etwas ist kaputt', hint: 'Was hast du gemacht, und was ist dann passiert?' },
  { id: 'wunsch', label: 'Etwas fehlt', hint: 'Was soll die App können?' },
  { id: 'sonstiges', label: 'Etwas anderes', hint: 'Alles, was weder ein Fehler noch ein Wunsch ist.' },
];

const ENDPOINT = 'https://api.web3forms.com/submit';
const ACCESS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_KEY || 'b95e413d-02de-4a1f-8bf8-406c224ca081';
const MIN_OPEN_MS = 3000;
const COOLDOWN_MS = 60_000;
const MAX_LEN = 4000;
const SENT_KEY = 'hh-feedback-sent';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function lastSent(): number {
  try {
    return Number(localStorage.getItem(SENT_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markSent() {
  try {
    localStorage.setItem(SENT_KEY, String(Date.now()));
  } catch {}
}

function FeedbackDialog({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<Kind>('fehler');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [state, setState] = useState<'schreiben' | 'sendet' | 'fertig'>('schreiben');
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const trap = useRef<HTMLInputElement>(null);
  const opened = useRef(Date.now());

  useEffect(() => {
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const send = async () => {
    if (trap.current?.checked) {
      // Looks like success to whatever ticked it, and sends nothing.
      setState('fertig');
      setTimeout(onDone, 2200);
      return;
    }
    if (Date.now() - opened.current < MIN_OPEN_MS) {
      setError('Einen Moment noch, dann bitte erneut auf „Absenden“ drücken.');
      return;
    }
    const wait = COOLDOWN_MS - (Date.now() - lastSent());
    if (wait > 0) {
      setError(`Bitte warte noch ${Math.ceil(wait / 1000)} Sekunden bis zur nächsten Rückmeldung.`);
      return;
    }
    const reply = replyTo.trim();
    if (reply && !EMAIL.test(reply)) {
      setError('Die Antwortadresse sieht nicht wie eine E-Mail-Adresse aus.');
      return;
    }
    setState('sendet');
    setError(null);
    try {
      const label = KINDS.find((k) => k.id === kind)!.label;
      const payload: Record<string, unknown> = {
        access_key: ACCESS_KEY,
        subject: `neu verbinden: ${label}`,
        from_name: 'neu verbinden',
        botcheck: false,
        Art: label,
        Nachricht: message.trim().slice(0, MAX_LEN),
        Seite: window.location.pathname + window.location.search,
      };
      if (reply) payload.replyto = reply;
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error('Die Rückmeldung konnte gerade nicht gesendet werden, bitte versuche es später erneut.');
      }
      markSent();
      setState('fertig');
      setTimeout(onDone, 2200);
    } catch (e) {
      setError(
        e instanceof TypeError
          ? 'Der Dienst für Rückmeldungen ist gerade nicht erreichbar.'
          : (e as Error).message
      );
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
        className="relative w-full max-w-[520px] rounded-t-3xl border border-line bg-paper p-4 shadow-2xl sm:rounded-2xl"
      >
        {state === 'fertig' ? (
          <div className="py-6 text-center">
            <div className="text-[28px]">✓</div>
            <h2 className="mt-2 text-[16px] font-semibold">Angekommen, danke.</h2>
            <p className="mt-1 text-[13.5px] text-muted">
              {replyTo ? 'Ich melde mich bei dir.' : 'Ich lese jede Meldung.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold">Rückmeldung</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  Sie geht direkt an mich, ohne dass du ein Konto oder eine Adresse brauchst.
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
                maxLength={MAX_LEN}
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

            {/* Out of sight and out of the tab order, so that only a bot that
                fills in every field it finds ticks it. */}
            <label aria-hidden className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
              Nicht ankreuzen
              <input ref={trap} type="checkbox" name="botcheck" tabIndex={-1} autoComplete="off" />
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
                {state === 'sendet' ? 'Wird gesendet …' : 'Absenden'}
              </button>
              <button className="btn" onClick={onDone}>
                Abbrechen
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">
              Die Nachricht wird über den Dienst Web3Forms per E-Mail an mich weitergeleitet,
              wobei weder ein Captcha noch eine Anmeldung nötig ist.
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
