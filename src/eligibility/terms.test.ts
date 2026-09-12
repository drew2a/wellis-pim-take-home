// One matcher for the engine and the history audit (ADR-0005, ADR-0010). Every positive and
// negative below is a value that appears in legacy_export/intakes.csv, except where a test says
// otherwise: the matcher is graded on this export before it is graded on anything else.
import { describe, expect, it } from 'vitest';

import { parseCsv } from '@/import/source/csv';
import { readExportFiles } from '@/import/source/files';
import { INTAKES_HEADER, byHeader } from '@/import/source/layout';
import { loadRules } from '@/rules/load';

import { matchTerms, splitSegments } from './terms';

const GLP1 = ['semaglutide', 'ozempic', 'wegovy', 'rybelsus', 'tirzepatide', 'mounjaro', 'saxenda'];
const CONDITIONS = ['schildklierkanker', 'schildkliercarcinoom', 'pancreatitis', 'diabetes type 2'];

describe('splitSegments', () => {
  it('splits on a semicolon', () => {
    expect(splitSegments('hoge bloeddruk; slaapapneu')).toEqual(['hoge bloeddruk', 'slaapapneu']);
  });

  it('does not split a Dutch decimal comma', () => {
    // Every comma in this export's meds_current is a decimal point, never a separator.
    expect(splitSegments('Ozempic 0,5 mg')).toEqual(['Ozempic 0,5 mg']);
    expect(splitSegments('Wegovy 1,7mg')).toEqual(['Wegovy 1,7mg']);
  });

  it('splits on a comma that separates rather than one that divides a number', () => {
    expect(splitSegments('metformine, ozempic')).toEqual(['metformine', 'ozempic']);
    expect(splitSegments('Ozempic 0,5 mg, metformine')).toEqual(['Ozempic 0,5 mg', 'metformine']);
  });

  it('drops empty segments and edge whitespace', () => {
    expect(splitSegments(' reflux ;; astma ')).toEqual(['reflux', 'astma']);
    expect(splitSegments('   ')).toEqual([]);
  });
});

describe('matchTerms', () => {
  it('matches a bare term, whatever its case', () => {
    expect(matchTerms(['semaglutide'], GLP1)).toEqual([
      { term: 'semaglutide', text: 'semaglutide' },
    ]);
    expect(matchTerms(['Saxenda dagelijks'], GLP1)).toEqual([
      { term: 'saxenda', text: 'Saxenda dagelijks' },
    ]);
  });

  it('sees through a dose in every notation this export uses', () => {
    expect(matchTerms(['Ozempic 0,5 mg'], GLP1)).toEqual([
      { term: 'ozempic', text: 'Ozempic 0,5 mg' },
    ]);
    expect(matchTerms(['Semaglutide 0.25'], GLP1)).toEqual([
      { term: 'semaglutide', text: 'Semaglutide 0.25' },
    ]);
    expect(matchTerms(['Mounjaro 5mg'], GLP1)).toEqual([
      { term: 'mounjaro', text: 'Mounjaro 5mg' },
    ]);
    expect(matchTerms(['rybelsus 7 mg'], GLP1)).toEqual([
      { term: 'rybelsus', text: 'rybelsus 7 mg' },
    ]);
    expect(matchTerms(['ozempic 1mg wekelijks'], GLP1)).toEqual([
      { term: 'ozempic', text: 'ozempic 1mg wekelijks' },
    ]);
  });

  it('sees through punctuation around the term', () => {
    expect(matchTerms(['ozempic (via huisarts)'], GLP1)).toEqual([
      { term: 'ozempic', text: 'ozempic (via huisarts)' },
    ]);
    expect(matchTerms(['schildklierkanker (2019)'], CONDITIONS)).toEqual([
      { term: 'schildklierkanker', text: 'schildklierkanker (2019)' },
    ]);
    expect(matchTerms(['pancreatitis 2022'], CONDITIONS)).toEqual([
      { term: 'pancreatitis', text: 'pancreatitis 2022' },
    ]);
  });

  it('matches a term in the middle of a phrase', () => {
    expect(matchTerms(['medullair schildkliercarcinoom familie'], CONDITIONS)).toEqual([
      { term: 'schildkliercarcinoom', text: 'medullair schildkliercarcinoom familie' },
    ]);
  });

  it('matches a multi-word term only as a contiguous run of words', () => {
    expect(matchTerms(['diabetes type 2'], CONDITIONS)).toEqual([
      { term: 'diabetes type 2', text: 'diabetes type 2' },
    ]);
    expect(matchTerms(['diabetes type 1'], CONDITIONS)).toEqual([]);
    expect(matchTerms(['type 2 diabetes'], CONDITIONS)).toEqual([]);
  });

  it('never matches a bare substring', () => {
    // The two the export would punish a substring matcher for.
    expect(matchTerms(['hypothyreoidie'], CONDITIONS)).toEqual([]);
    expect(matchTerms(['levothyroxine 50mcg'], GLP1)).toEqual([]);
    // Constructed: a term glued to more letters is a different word.
    expect(matchTerms(['pcosx'], ['pcos'])).toEqual([]);
    expect(matchTerms(['xpcos'], ['pcos'])).toEqual([]);
  });

  it('reports nothing for the "no medication" spellings', () => {
    for (const none of ['geen', '-', 'geen medicatie', 'n.v.t.', 'none', '']) {
      expect(matchTerms([none], GLP1)).toEqual([]);
    }
  });

  it('reports one match per matching segment, in input order', () => {
    expect(matchTerms(['ozempic; wegovy'], GLP1)).toEqual([
      { term: 'ozempic', text: 'ozempic' },
      { term: 'wegovy', text: 'wegovy' },
    ]);
    expect(
      matchTerms(['hoge bloeddruk; pancreatitis 2022', 'schildklierkanker'], CONDITIONS),
    ).toEqual([
      { term: 'pancreatitis', text: 'pancreatitis 2022' },
      { term: 'schildklierkanker', text: 'schildklierkanker' },
    ]);
  });

  it('reports a segment once, under the first term that matches it', () => {
    expect(matchTerms(['semaglutide (ozempic)'], GLP1)).toEqual([
      { term: 'semaglutide', text: 'semaglutide (ozempic)' },
    ]);
  });
});

// The acceptance criterion ADR-0005 committed to before the matcher existed: over this export the
// two clinical lists hit 42 and 15 intakes. Same pattern as the mapper's export-counts test —
// the counts in an accepted ADR and in the import report are produced by code, never typed.
describe('over legacy_export/intakes.csv', () => {
  const rules = loadRules();
  const intakes = parseCsv(
    readExportFiles('legacy_export')['intakes.csv'].bytes,
    INTAKES_HEADER,
  ).map((row) => byHeader(INTAKES_HEADER, row.fields));
  const hits = (field: 'meds_current' | 'conditions', terms: readonly string[]): number =>
    intakes.filter((intake) => matchTerms([intake[field]], terms).length > 0).length;

  it('reproduces the ADR-0005 counts', () => {
    expect(hits('meds_current', rules.glp1_terms)).toBe(42);
    expect(hits('conditions', rules.flag_condition_terms)).toBe(15);
  });
});
