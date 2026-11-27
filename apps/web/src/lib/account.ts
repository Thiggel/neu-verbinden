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
import { api, ApiError, session } from '@/lib/api';

/** Kept in step with the server, which rejects anything shorter. */
export const MIN_PASSWORD = 8;

/** What the dialog says it is for, so it does not talk about publishing when
 *  someone was about to agree with a plan. */
export type AccountPurpose = 'publish' | 'vote' | 'fork' | 'comment' | 'report';

const WORDING: Record<AccountPurpose, { title: string; intro: string }> = {
  publish: {
    title: 'Wer veröffentlicht?',
    intro: 'Damit der Entwurf dir gehört, genügen ein Name und ein Passwort, eine E-Mail-Adresse ist nicht nötig.',
  },
  vote: {
    title: 'Wer stimmt zu?',
    intro: 'Damit deine Stimme genau einmal zählt, genügen ein Name und ein Passwort, eine E-Mail-Adresse ist nicht nötig.',
  },
  fork: {
    title: 'Wer baut weiter?',
    intro: 'Damit dir gehört, was du daraus machst, genügen ein Name und ein Passwort, eine E-Mail-Adresse ist nicht nötig.',
  },
  comment: {
    title: 'Wer schreibt?',
    intro: 'Damit dein Name an deinem Beitrag steht, genügen ein Name und ein Passwort, eine E-Mail-Adresse ist nicht nötig.',
  },
  report: {
    title: 'Wer meldet?',
    intro: 'Weil eine Meldung einem Konto zugeordnet sein muss, brauchst du einen Namen und ein Passwort, eine E-Mail-Adresse ist nicht nötig.',
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
          v.length < MIN_PASSWORD ? `Es fehlen noch ${MIN_PASSWORD - v.length} Zeichen.` : null,
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
  } catch (e) {
    // Only a refused login means there may be no account yet; a server that
    // is down would fail the registration the same way.
    if (!(e instanceof ApiError && e.status === 401)) throw e;
  }
  try {
    const res = await api.register({ handle, password });
    session.set(res.token);
    return res.token;
  } catch (e) {
    // The login just failed, so a name that is taken means the password was
    // not the one of that account.
    if (e instanceof ApiError && e.status === 409) {
      throw new Error('Unter diesem Namen gibt es schon ein Konto, dessen Passwort ein anderes ist.');
    }
    throw e;
  }
}
