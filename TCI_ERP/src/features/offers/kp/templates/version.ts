/** The version of the approved TCI template — printed in every page's legal
 * line and stored with an offer's parameters. Its own module, so screens that
 * only stamp it (params.ts) do not pull the template's words into their
 * bundle. Bump it when the words change (tci.test.ts pins them). */
export const TCI_BROCHURE_VERSION = 'TCI 10/26'
