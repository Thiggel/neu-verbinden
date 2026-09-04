'use client';

// A small promise-based dialog, used everywhere the app used to call
// `window.prompt`.
//
// Two reasons it exists. The native prompt is simply unavailable in a number of
// embedded browsers — the publish flow threw "prompt() is not supported" and
// lost the entered title — and it is also the least inviting piece of UI a
// browser has to offer, which is the opposite of what this application is
// meant to feel like. Asking for a name should look like part of the map, not
// like a security warning.

import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';

export interface Field {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  /** A textarea rather than a single line. */
  multiline?: boolean;
  /** Rendered as a password field. Never logged, never pre-filled. */
  secret?: boolean;
  /**
   * A choice between named options rather than free text.
   *
   * Rendered as radio buttons, because the point is that both options are
   * visible before you pick: the publish dialog uses this to ask whether other
   * people's projects should count towards your plan's cost, and a menu that
   * hides the alternative would be a worse way to ask it.
   */
  choices?: { value: string; label: string; hint?: string }[];
  optional?: boolean;
  hint?: string;
  /**
   * Checked before the dialog closes. Return a message to refuse, or `null` to
   * accept.
   *
   * Without this the only check was "not empty": a password that was too short
   * closed the dialog, went to the server, and came back as a toast saying it
   * failed — after the typed values were gone. A rule the form knows is a rule
   * the form should apply.
   */
  validate?: (value: string) => string | null;
}

export interface AskOptions {
  title: string;
  intro?: string;
  fields: Field[];
  confirm?: string;
  cancel?: string;
}

/**
 * Ask the user to fill in a few fields.
 *
 * Resolves with the values, or `null` if the dialog was dismissed.
 */
export function ask(options: AskOptions): Promise<Record<string, string> | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  return new Promise((resolve) => {
    const done = (value: Record<string, string> | null) => {
      root.unmount();
      host.remove();
      resolve(value);
    };
    root.render(<DialogView options={options} onDone={done} />);
  });
}

/** The common case: one line of text. Resolves to `null` when cancelled. */
export async function askText(
  title: string,
  label: string,
  value = '',
  extra: Partial<Field> & { confirm?: string; intro?: string } = {}
): Promise<string | null> {
  const { confirm, intro, ...field } = extra;
  const out = await ask({ title, intro, confirm, fields: [{ name: 'value', label, value, ...field }] });
  return out ? out.value : null;
}

/** A yes/no question. */
export function askConfirm(title: string, intro: string, confirm = 'Ja'): Promise<boolean> {
  return ask({ title, intro, fields: [], confirm }).then((v) => v != null);
}

function DialogView({ options, onDone }: { options: AskOptions; onDone: (v: Record<string, string> | null) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(options.fields.map((f) => [f.name, f.value ?? '']))
  );
  const [shown, setShown] = useState(false);
  const first = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setShown(true);
    const t = setTimeout(() => first.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDone(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missing = options.fields.some((f) => !f.optional && !values[f.name]?.trim());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missing) return;
    const found: Record<string, string> = {};
    for (const f of options.fields) {
      const msg = f.validate?.(values[f.name]?.trim() ?? '');
      if (msg) found[f.name] = msg;
    }
    setErrors(found);
    // Stay open with what was typed still in place.
    if (Object.keys(found).length) return;
    onDone(Object.fromEntries(options.fields.map((f) => [f.name, values[f.name]?.trim() ?? ''])));
  };

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center p-4 transition-opacity duration-150 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgb(10 14 20 / 38%)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={options.title}
        className={`w-full max-w-[400px] rounded-2xl border border-line bg-paper p-4 shadow-2xl transition-all duration-150 ${
          shown ? 'translate-y-0 scale-100' : 'translate-y-2 scale-[0.98]'
        }`}
      >
        <h2 className="text-[15px] font-semibold">{options.title}</h2>
        {options.intro && <p className="mt-1 text-[13px] leading-snug text-muted">{options.intro}</p>}
        {options.fields.map((f, i) => (
          <label key={f.name} className="mt-3 block">
            <span className="text-[12px] font-medium text-muted">
              {f.label}
              {f.optional && <span className="font-normal"> · optional</span>}
            </span>
            {f.choices ? (
              <div className="mt-1 space-y-1">
                {f.choices.map((c) => (
                  <label
                    key={c.value}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                      values[f.name] === c.value ? 'border-ink/40 bg-subtle' : 'border-line hover:bg-subtle'
                    }`}
                  >
                    <input
                      type="radio"
                      name={f.name}
                      value={c.value}
                      checked={values[f.name] === c.value}
                      onChange={() => setValues((v) => ({ ...v, [f.name]: c.value }))}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{c.label}</span>
                      {c.hint && <span className="block text-[11.5px] leading-snug text-muted">{c.hint}</span>}
                    </span>
                  </label>
                ))}
              </div>
            ) : f.multiline ? (
              <textarea
                ref={i === 0 ? (first as React.RefObject<HTMLTextAreaElement>) : undefined}
                rows={3}
                value={values[f.name] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className="mt-1 w-full resize-none rounded-lg border border-line bg-subtle px-2.5 py-2 text-[13px] outline-none focus:border-ink/30"
              />
            ) : (
              <input
                ref={i === 0 ? (first as React.RefObject<HTMLInputElement>) : undefined}
                type={f.secret ? 'password' : 'text'}
                autoComplete={f.secret ? 'current-password' : 'off'}
                value={values[f.name] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [f.name]: e.target.value }));
                  // Clear the complaint as soon as they act on it.
                  setErrors((x) => (x[f.name] ? { ...x, [f.name]: '' } : x));
                }}
                aria-invalid={!!errors[f.name]}
                className={`mt-1 w-full rounded-lg border bg-subtle px-2.5 py-2 text-[13px] outline-none ${
                  errors[f.name] ? 'border-rose-500' : 'border-line focus:border-ink/30'
                }`}
              />
            )}
            {errors[f.name] ? (
              <span className="mt-1 block text-[11px] font-medium text-rose-500">{errors[f.name]}</span>
            ) : (
              f.hint && <span className="mt-1 block text-[11px] text-muted">{f.hint}</span>
            )}
          </label>
        ))}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onDone(null)}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-subtle"
          >
            {options.cancel ?? 'Abbrechen'}
          </button>
          <button
            type="submit"
            disabled={missing}
            className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-paper disabled:opacity-40"
          >
            {options.confirm ?? 'Weiter'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- toasts --

/**
 * A short confirmation or error, shown at the bottom of the screen.
 *
 * Replaces `window.alert`, which blocks the page, cannot be styled, and is
 * unavailable in some embedded browsers.
 */
export function toast(message: string, tone: 'info' | 'warn' = 'info') {
  if (typeof document === 'undefined') return;
  let host = document.getElementById('hh-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'hh-toasts';
    host.className = 'pointer-events-none fixed inset-x-0 bottom-5 z-[90] flex flex-col items-center gap-2';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.className =
    'rounded-full px-3.5 py-2 text-[13px] font-medium shadow-lg transition-all duration-200 ' +
    (tone === 'warn' ? 'bg-[#b4342a] text-white' : 'bg-[#14181f] text-white');
  el.style.opacity = '0';
  el.style.transform = 'translateY(6px)';
  el.textContent = message;
  host.appendChild(el);
  // Reading a layout property flushes the initial style, so the transition has
  // something to move from. Doing this instead of waiting for the next
  // animation frame matters: `requestAnimationFrame` does not fire while the
  // tab is hidden, so a toast raised there stayed at opacity 0 and was then
  // removed by the timer below — the message was never shown at all. Publishing
  // a plan and switching tabs while it uploads is exactly that case.
  void el.offsetHeight;
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}
