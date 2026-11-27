// Who runs this service.
//
// § 5 DDG (the Digitale-Dienste-Gesetz, which replaced the TMG in May 2024)
// requires a German site to name its operator, with an address that can take
// post and a way to reach them electronically. It has to be easy to find,
// reachable directly and available at all times, which is why the footer links
// it from every page.
//
// These values cannot be guessed, and inventing them would be worse than
// leaving them out: an Impressum naming the wrong person is itself a fault.
// `test:ui` fails while any placeholder is still here, so this cannot reach the
// public by being forgotten.
//
// This is a private individual's own address, which § 5 DDG requires because it
// has to be one where documents can actually be served: a post box does not
// qualify. It does not have to be a home, though. A forwarding address, a
// coworking space or an association willing to host the project would each work
// and would keep this out of the open. See docs/recht.md.
export const OPERATOR = {
  /** Full name, or the company with its legal form. */
  name: 'Filipe Laitenberger',
  /** Street and number. A PO box is not sufficient under § 5 DDG. */
  street: 'Lohbrügger Landstraße 8',
  /** Postcode and town. */
  city: '21031 Hamburg',
  country: 'Deutschland',
  /** Must actually be read: it is also the contact point under Art. 12 DSA. */
  email: 'f.laitenberger@gmail.com',
  /**
   * Only needed where journalistic or editorial content is published. A tool
   * that computes transport figures is not that, so this stays empty unless the
   * site starts publishing articles.
   */
  responsibleForContent: '',
  /** VAT id, where one exists. Private operators have none. */
  vatId: '',
};

/** Whether the operator's details have actually been filled in. */
export const impressumIsComplete = () =>
  !Object.values(OPERATOR).some((v) => v.includes('BITTE-AUSFUELLEN'));
