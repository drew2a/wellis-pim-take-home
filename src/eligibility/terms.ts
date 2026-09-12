// Term matching for the eligibility rules, shared by the engine and the import-time history audit
// (ADR-0005, ADR-0010). Deterministic and explainable: no fuzzy matching, no stemming, and never
// a bare substring — `hypothyreoidie` is not thyroid cancer and `levothyroxine` is not a GLP-1.

/** A ruleset term together with the text that matched it, as the patient typed it. */
export interface TermMatch {
  readonly term: string;
  readonly text: string;
}

// A semicolon always separates; a comma separates only when it is not a decimal point. Every
// comma in this export's meds_current divides a number (`Ozempic 0,5 mg`), so splitting on all of
// them would quote `Ozempic 0` in the reason string.
const SEPARATOR = /;|,(?!\d)/u;

/** The segments of one free-text value: what a reason string quotes. */
export function splitSegments(value: string): string[] {
  return value
    .split(SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
}

// Letters and digits survive, everything else becomes a boundary. Digits are kept because
// `diabetes type 2` is a term; doses fall apart into their own tokens and stop mattering.
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((token) => token !== '');
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
}

/**
 * Every segment of `values` that contains one of `terms` as a contiguous run of words, reported
 * once under the first term that matches it, in input order.
 */
export function matchTerms(values: readonly string[], terms: readonly string[]): TermMatch[] {
  const needles = terms.map((term) => {
    const tokens = tokenise(term);
    // Unreachable through `loadRules`: the ruleset schema rejects a term without a letter or a
    // digit at load. Kept as an assertion, because such a term would match every segment.
    if (tokens.length === 0) throw new Error(`ruleset term has no letters or digits: ${term}`);
    return { term, tokens };
  });

  const matches: TermMatch[] = [];
  for (const value of values) {
    for (const segment of splitSegments(value)) {
      const tokens = tokenise(segment);
      const hit = needles.find((needle) => containsRun(tokens, needle.tokens));
      if (hit !== undefined) matches.push({ term: hit.term, text: segment });
    }
  }
  return matches;
}
