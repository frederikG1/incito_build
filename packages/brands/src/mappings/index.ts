/**
 * Every feed mapping, one file each.
 *
 * A mapping is a pure `FieldMapping` from `@incitio/ingest`: where each
 * Offer field lives in one format's rows. No I/O, no design, no brand
 * tokens — those live in `../brands/`. To add or change one:
 *
 *   1. copy the closest file here (`demo-csv.ts` is the smallest),
 *   2. run `npm run map -- <feed file> --mapping <id> --check`,
 *   3. read the report: dropped rows, empty fields, unread columns,
 *   4. `npm test -- mappings` pins every sample in `data/feeds`.
 */
export * from './coop-export.js';
export * from './datafeedwatch-nemlig.js';
export * from './demo-csv.js';
export * from './tjek.js';
export * from './tjek-transformed-out.js';
