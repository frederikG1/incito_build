import { describe, expect, it } from 'vitest';
import {
  MAX_REFERENCE_PAGES, pageNumbers, referenceJobs, wholeDocument, type ReferenceFile,
} from '../state.js';

const file = (over: Partial<ReferenceFile> = {}): ReferenceFile => ({
  id: 'r1',
  name: 'p08.jpg',
  base64: 'AAA',
  isPdf: false,
  pageCount: null,
  pages: '1',
  ...over,
});

describe('pageNumbers', () => {
  it('reads a single page, a range and a list', () => {
    expect(pageNumbers('4')).toEqual([4]);
    expect(pageNumbers('1-6')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pageNumbers('2,5,9')).toEqual([2, 5, 9]);
    expect(pageNumbers('1-2, 7')).toEqual([1, 2, 7]);
  });

  it('keeps the order that was typed', () => {
    // "7,1" is someone putting page seven first, not a mistake to sort.
    expect(pageNumbers('7,1')).toEqual([7, 1]);
  });

  it('reads a backwards range forwards', () => {
    expect(pageNumbers('6-4')).toEqual([4, 5, 6]);
  });

  it('asks for a page once, however many times it is named', () => {
    // Each page is a model call; the second one would print the same
    // grid with different products, which nobody means by "3,3".
    expect(pageNumbers('3,3,2-3')).toEqual([3, 2]);
  });

  it('is empty while it is still being typed, rather than guessing', () => {
    expect(pageNumbers('')).toEqual([]);
    expect(pageNumbers('1-')).toEqual([]);
    expect(pageNumbers('side fire')).toEqual([]);
  });

  it('drops a page number no PDF has', () => {
    expect(pageNumbers('0')).toEqual([]);
    expect(pageNumbers('999')).toEqual([]);
  });
});

describe('referenceJobs', () => {
  it('makes one job per image, whatever the page field says', () => {
    const jobs = referenceJobs([file({ pages: '1-6' })]);
    expect(jobs).toEqual([{ refId: 'r1', name: 'p08.jpg', base64: 'AAA' }]);
  });

  it('makes one job per page of a PDF, named so a failure is placeable', () => {
    const jobs = referenceJobs([file({ name: 'avis.pdf', isPdf: true, pages: '2-3' })]);
    expect(jobs).toEqual([
      { refId: 'r1', name: 'avis.pdf s. 2', base64: 'AAA', pageNumber: 2 },
      { refId: 'r1', name: 'avis.pdf s. 3', base64: 'AAA', pageNumber: 3 },
    ]);
  });

  it('falls back to the first page rather than dropping a PDF silently', () => {
    const jobs = referenceJobs([file({ name: 'avis.pdf', isPdf: true, pages: '' })]);
    expect(jobs).toEqual([{ refId: 'r1', name: 'avis.pdf s. 1', base64: 'AAA', pageNumber: 1 }]);
  });

  it('keeps the list in the order the pages will print', () => {
    const jobs = referenceJobs([
      file({ id: 'a', name: 'forside.png' }),
      file({ id: 'b', name: 'avis.pdf', isPdf: true, pages: '4-5' }),
      file({ id: 'c', name: 'bagside.png' }),
    ]);
    expect(jobs.map((job) => job.name))
      .toEqual(['forside.png', 'avis.pdf s. 4', 'avis.pdf s. 5', 'bagside.png']);
  });

  it('stops at the cap, because every page is a model call', () => {
    const jobs = referenceJobs([file({ name: 'avis.pdf', isPdf: true, pages: '1-80' })]);
    expect(jobs).toHaveLength(MAX_REFERENCE_PAGES);
  });
});

describe('wholeDocument', () => {
  it('names every page of the file', () => {
    // A chain hands in last week's avis as one PDF: a row that stood at
    // "1" read as a tool that could only see the front page.
    expect(wholeDocument(30)).toBe('1-30');
    expect(pageNumbers(wholeDocument(30))).toHaveLength(30);
  });

  it('writes a single page as a page, not as a range', () => {
    expect(wholeDocument(1)).toBe('1');
  });

  it('asks for one page when the length could not be read', () => {
    // A range built on a guess asks the server for pages the file does
    // not have, and every one of those is a failed model call.
    expect(wholeDocument(null)).toBe('1');
    expect(wholeDocument(0)).toBe('1');
  });
});
