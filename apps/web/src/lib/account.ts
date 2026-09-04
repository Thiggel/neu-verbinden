// Getting a session at the moment one is actually needed.
//
// There is no separate sign-in step: an account exists to own what you make, so
// it is asked for when you first make something. The same dialog covers signing
// in and signing up — the name either exists, and the password has to match, or
// it does not and is created.
//
// This lived inside the editor page while publishing was the only action that
// needed it. Voting, forking and commenting need it too, and they used to say
// "you need an account — create one at the top right", which is a worse answer
// than simply asking: it interrupts the thing you were doing and makes you go
// looking for a control you were not using.

import { ask } from '@/components/Dialog';
import { api, session } from '@/lib/api';

/** Kept in step with the server, which rejects anything shorter. */
export const MIN_PASSWORD = 8;

/** What the dialog says it is for, so it does not talk about publishing when
 *  someone was about to agree with a plan. */
export type AccountPurpose = 'publish' | 'vote' | 'fork' | 'comment' | 'report';

const WORDING: Record<AccountPurpose, { title: string; intro: string }> = {
  publish: {
    title: 'Wer veröffentlicht?',
    intro: 'Ein Name und ein Passwort genügen, keine E-Mail-Adresse. Damit gehört der Entwurf dir.',
  },
  vote: {
    title: 'Wer stimmt zu?',
    intro: 'Ein Name und ein Passwort genügen, keine E-Mail-Adresse. Damit zählt deine Stimme genau einmal.',
  },
  fork: {
    title: 'Wer baut weiter?',
    intro: 'Ein Name und ein Passwort genügen, keine E-Mail-Adresse. Damit gehört dir, was du daraus machst.',
  },
  comment: {
    title: 'Wer schreibt?',
    intro: 'Ein Name und ein Passwort genügen, keine E-Mail-Adresse. Damit steht dein Name an deinem Beitrag.',
  },
  report: {
    title: 'Wer meldet?',
    intro: 'Ein Name und ein Passwort genügen, keine E-Mail-Adresse. Meldungen ohne Konto wären wertlos.',
  },
};

/** The current session, asking for an account if there is none. */
export async function ensureSession(purpose: AccountPurpose = 'publish'): Promise<string | null> {
  const existing = session.get();
  if (existing) return existing;
  const answers = await ask({
    ...WORDING[purpose],
    fields: [
      { name: 'handle', label: 'Nutzername', hint: 'Kleinbuchstaben, Ziffern, _ und -' },
      {
        name: 'password',
        label: 'Passwort',
        secret: true,
        hint: `Mindestens ${MIN_PASSWORD} Zeichen`,
        validate: (v) =>
          v.length < MIN_PASSWORD ? `Noch ${MIN_PASSWORD - v.length} Zeichen fehlen.` : null,
      },
    ],
    confirm: 'Weiter',
  });
  if (!answers) return null;
  const { handle, password } = answers;
  try {
    const res = await api.login({ handle, password });
    session.set(res.token);
    return res.token;
  } catch {
    // No account yet — or the wrong password, which `register` reports as a
    // name that is already taken.
  }
  const res = await api.register({ handle, password });
  session.set(res.token);
  return res.token;
}
