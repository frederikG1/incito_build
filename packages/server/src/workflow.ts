import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  APPROVAL_ROLE_NAMES, APPROVAL_ROLES, LIVE_KINDS, type Brand, type CatalogDocument, type LiveEvent,
} from '@incitio/schema';
import { resolveTemplate, type BrandDefinition } from '@incitio/brands';
import { resolveVariant } from '@incitio/edit';
import {
  applyLive, checkWrite, heeded, keepWorkflow, LiveError, publishBlockers, signed, standInPrices, unsigned,
  type Blocker, type Finding, type PriceSource, type ResolvedEdition, type Stop,
} from '@incitio/workflow';
import { SaveConflict, type Store } from './db.js';
import { maySign, type User } from './auth.js';

/**
 * Every write to a stored catalogue, and the workflow around it.
 *
 * Two rules hold here whatever the caller is — the studio, a script,
 * an agent with `/ops`:
 *
 * - A write is read, decided and saved with nothing awaited in between
 *   (`commit`). Node runs one request's synchronous code at a time and
 *   the store is synchronous SQLite, so two writes cannot interleave and
 *   neither can quietly undo the other.
 * - Signatures, sold places, the live log and publishing are written
 *   only by the endpoints below. A plain save keeps what is stored
 *   (`keepWorkflow`), may not break a sold place, and on a published
 *   avis may not introduce a price the rules stop (`checkWrite`).
 */

interface Scope { Variables: { brand: BrandDefinition; user: User | null } }

/** A write refused, with the status and body to answer with. */
export class Refused extends Error {
  constructor(readonly status: 403 | 404 | 409 | 422 | 428, readonly body: Record<string, unknown>) {
    super(String(body['error'] ?? 'refused'));
  }
}

export interface Write {
  document: CatalogDocument;
  label: string;
  /**
   * A workflow endpoint: it writes the workflow fields itself, so they
   * are not reset to what is stored. Only the endpoints in this file set it.
   */
  owner?: boolean;
  /** Run the sold-place and price checks even on an owner's write — the live endpoint's. */
  check?: boolean;
}

export interface Committed { document: CatalogDocument; kept: string[] }

let counter = 0;
const eventId = () => `l-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Every edition of a document, resolved; editions that do not resolve are left to the studio to report. */
function editionsOf(document: CatalogDocument, brand: Brand): ResolvedEdition[] {
  return (document.variants ?? []).flatMap((variant) => {
    try {
      return [{ id: variant.id, name: variant.name, document: resolveVariant(document, variant.id, brand).document }];
    } catch {
      return [];
    }
  });
}

export function makeCommit(store: Store, prices: PriceSource) {
  /**
   * Read the stored catalogue, let `write` decide the next one, check it
   * and save it — synchronously, so nothing can be saved in between.
   *
   * `expected` is the `updatedAt` the caller last saw. Undefined skips the
   * check, which only callers whose write is a delta may do (`/ops`, a
   * rename): a delta applied to the latest document loses nothing. A
   * whole-document save must state it — see the PUT route.
   */
  return function commit(
    brand: Brand,
    id: string,
    expected: string | undefined,
    write: (stored: CatalogDocument) => Write,
  ): Committed {
    const stored = store.get(brand.id, id);
    if (!stored) throw new Refused(404, { error: 'not found' });
    if (expected !== undefined && expected !== stored.updatedAt) {
      throw new Refused(409, { error: 'the catalogue changed since it was read', updatedAt: stored.updatedAt });
    }
    const result = write(stored);
    let next = result.document;
    let kept: string[] = [];
    if (!result.owner) ({ document: next, kept } = keepWorkflow(stored, next));

    if (!result.owner || result.check) {
      const refused: Stop[] = [];
      const verdict = checkWrite(stored, next, { prices, who: 'redigering', brand });
      refused.push(...verdict.refused);
      /*
       * Each edition as its shoppers see it: a store's edit may not break
       * a place sold for every store. Only worth resolving when a check
       * can refuse — something sold, or the avis out.
       */
      const guarded = (stored.bookings?.length ?? 0) > 0 || stored.status === 'udgivet';
      const before = new Map(guarded ? editionsOf(stored, brand).map((edition) => [edition.id, edition]) : []);
      for (const edition of guarded ? editionsOf(next, brand) : []) {
        const then = before.get(edition.id);
        if (!then) continue;
        for (const stop of checkWrite(then.document, edition.document, { prices, brand }).refused) {
          if (!refused.some((r) => r.id === stop.id)) refused.push({ ...stop, said: `${edition.name}: ${stop.said}` });
        }
      }
      if (refused.length) {
        throw new Refused(422, { error: refused.map((stop) => stop.said).join(' · '), refused });
      }
      if (verdict.logged.length && !result.owner) {
        const at = new Date().toISOString();
        next = { ...next, live: [...(next.live ?? []), ...verdict.logged.map((event): LiveEvent => ({ ...event, id: eventId(), at }))] };
      }
    }

    try {
      // `expected` here cannot fail — nothing ran since the read — and is kept as the last line of defence.
      return { document: store.save(brand.id, { ...next, updatedAt: stored.updatedAt }, result.label, { expected: stored.updatedAt }), kept };
    } catch (error) {
      if (error instanceof SaveConflict) throw new Refused(409, { error: error.message, updatedAt: error.updatedAt });
      throw error;
    }
  };
}

export type Commit = ReturnType<typeof makeCommit>;

/** Answer a refused write, or rethrow what is not one. */
export function refusal(c: Context, error: unknown) {
  if (error instanceof Refused) return c.json(error.body, error.status);
  throw error;
}

const Stamp = z.object({
  /** The `updatedAt` the caller last saw. Required: every workflow act is about the avis as seen. */
  updatedAt: z.string().min(1),
  /** Who is acting, as they gave their name. Stated, not proven — see the note on identity. */
  who: z.string().trim().max(80).default(''),
});

/** A signature needs a name: it is the one act whose point is who did it. */
const ApproveRequest = Stamp.extend({ role: z.enum(APPROVAL_ROLES), who: z.string().trim().min(1).max(80) });
const BookRequest = Stamp.omit({ who: true }).extend({
  pageId: z.string().min(1),
  slotId: z.string().min(1),
  supplier: z.string().trim().min(1).max(80),
  offerId: z.string().nullable().default(null),
  price: z.number().nonnegative().max(10_000_000),
  note: z.string().max(200).default(''),
});
const LiveRequest = Stamp.extend({
  kind: z.enum(LIVE_KINDS),
  offerId: z.string().min(1),
  substituteId: z.string().nullable().default(null),
  after: z.number().nullable().default(null),
});

/** Draw an avis and measure it — the print checks that need the page drawn. Absent: those are not run. */
export type Measure = (document: CatalogDocument, brand: Brand) => Promise<Finding[]>;

export function workflowRoutes(
  app: Hono<Scope>, store: Store, commit: Commit, prices: PriceSource = standInPrices, measure?: Measure,
) {
  const body = async <T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> => {
    let payload: unknown;
    try { payload = await c.req.json(); } catch { throw new Refused(422, { error: 'body is not valid JSON' }); }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Refused(422, { error: 'invalid request', issues: parsed.error.issues.slice(0, 5) });
    /*
     * Signed in, the name on a signature is the account's, whatever the
     * body says: "who" is then proven, not stated.
     */
    const user = (c as Context<Scope>).get('user');
    if (user && parsed.data && typeof parsed.data === 'object' && 'who' in parsed.data) {
      return { ...parsed.data, who: user.name };
    }
    return parsed.data;
  };
  const stampOf = (c: Context): string => {
    const stamp = c.req.query('updatedAt');
    if (!stamp) throw new Refused(428, { error: 'updatedAt is required: say which version of the avis this is about' });
    return stamp;
  };
  const notPublished = (document: CatalogDocument, what: string) => {
    if (document.status === 'udgivet') throw new Refused(422, { error: `avisen er udgivet — ${what} sker som en live-ændring` });
  };
  /*
   * Signed in, a sign-off is signed by someone whose membership holds
   * that role (or admin) — see `maySign`. Signed out (sign-in off, the
   * laptop) the name is stated, as it always was.
   */
  const mayAct = (c: Context, brandId: string, role: (typeof APPROVAL_ROLES)[number]) => {
    const user = (c as Context<Scope>).get('user');
    if (user && !maySign(user, brandId, role)) {
      throw new Refused(403, { error: `du kan ikke godkende som ${APPROVAL_ROLE_NAMES[role].toLowerCase()} — bed en admin om rollen` });
    }
  };
  const answer = (c: Context, run: () => Committed | Promise<Committed>) =>
    Promise.resolve().then(run).then((done) => c.json({ document: done.document }), (error) => refusal(c, error));

  /*
   * Sign-off. The server signs what it holds — not what a screen shows,
   * which may be unsaved — and records the version the signature is
   * saved as, so "what did Pris see" is one fetch from the history.
   */
  app.post('/api/brand/catalogs/:id/approvals', (c) => answer(c, async () => {
    const { brand } = c.get('brand');
    const request = await body(c, ApproveRequest);
    mayAct(c, brand.id, request.role);
    return commit(brand, c.req.param('id'), request.updatedAt, (stored) => {
      notPublished(stored, 'godkendelse');
      const at = new Date().toISOString();
      return {
        document: signed(stored, request.role, request.who, at, store.nextVersion(stored.id)),
        label: `godkendt · ${APPROVAL_ROLE_NAMES[request.role]} · ${request.who}`,
        owner: true,
      };
    });
  }));

  app.delete('/api/brand/catalogs/:id/approvals/:role', (c) => answer(c, () => {
    const { brand } = c.get('brand');
    const role = z.enum(APPROVAL_ROLES).safeParse(c.req.param('role'));
    if (!role.success) throw new Refused(404, { error: `no role "${c.req.param('role')}"` });
    mayAct(c, brand.id, role.data);
    return commit(brand, c.req.param('id'), stampOf(c), (stored) => {
      notPublished(stored, 'at trække en godkendelse tilbage');
      return { document: unsigned(stored, role.data), label: `godkendelse trukket · ${APPROVAL_ROLE_NAMES[role.data]}`, owner: true };
    });
  }));

  /*
   * Sold places. A place is sold once: a second sale of the same place
   * is refused rather than replacing the first — two buyers selling the
   * front page in the same minute is the double booking this prevents.
   */
  app.post('/api/brand/catalogs/:id/bookings', (c) => answer(c, async () => {
    const { brand } = c.get('brand');
    const request = await body(c, BookRequest);
    return commit(brand, c.req.param('id'), request.updatedAt, (stored) => {
      const page = stored.pages.find((p) => p.id === request.pageId);
      if (!page) throw new Refused(422, { error: `no page "${request.pageId}"` });
      const template = resolveTemplate(brand, page.templateId) ?? stored.templates.find((t) => t.id === page.templateId);
      if (template && !template.slots.some((slot) => slot.id === request.slotId)) {
        throw new Refused(422, { error: `page ${request.pageId} has no place "${request.slotId}"` });
      }
      if (request.offerId && !stored.offers.some((o) => o.id === request.offerId)) {
        throw new Refused(422, { error: `no offer "${request.offerId}"` });
      }
      const taken = (stored.bookings ?? []).find((b) => b.pageId === request.pageId && b.slotId === request.slotId);
      if (taken) throw new Refused(409, { error: `pladsen er allerede solgt til ${taken.supplier}`, booking: taken });
      const { updatedAt: _seen, ...deal } = request;
      return {
        document: {
          ...stored,
          bookings: [...(stored.bookings ?? []), { ...deal, id: `b-${Date.now().toString(36)}-${(counter++).toString(36)}`, at: new Date().toISOString() }],
          // Locked in its place: a new week and a re-layout leave it there.
          pages: stored.pages.map((p) => (p.id !== page.id ? p : {
            ...p,
            placements: p.placements.map((pl) => (pl.slotId === request.slotId ? { ...pl, overrides: { ...pl.overrides, pinned: true } } : pl)),
          })),
        },
        label: `plads solgt · ${request.supplier}`,
        owner: true,
      };
    });
  }));

  app.delete('/api/brand/catalogs/:id/bookings/:bookingId', (c) => answer(c, () => {
    const { brand } = c.get('brand');
    return commit(brand, c.req.param('id'), stampOf(c), (stored) => {
      const booking = (stored.bookings ?? []).find((b) => b.id === c.req.param('bookingId'));
      if (!booking) throw new Refused(404, { error: 'no such booking' });
      return {
        document: { ...stored, bookings: (stored.bookings ?? []).filter((b) => b.id !== booking.id) },
        label: `plads frigivet · ${booking.supplier}`,
        owner: true,
      };
    });
  }));

  /*
   * Publishing: the one door into "udgivet". Every role signed on what
   * is there now, and no stop in the price rules or on a sold place —
   * in the avis and in every edition.
   */
  app.post('/api/brand/catalogs/:id/publish', (c) => answer(c, async () => {
    const { brand } = c.get('brand');
    const request = await body(c, Stamp);
    const id = c.req.param('id');
    const gate = (stored: CatalogDocument): Blocker[] => {
      if (stored.status === 'udgivet') throw new Refused(422, { error: 'avisen er allerede udgivet' });
      return publishBlockers(stored, editionsOf(stored, brand), prices, brand);
    };
    const refuse = (blockers: Blocker[]) => new Refused(422, { error: blockers.map((b) => b.said).join(' · '), blockers });

    // What the document can answer, first: it is instant, and a missing signature needs no browser.
    const seen = store.get(brand.id, id);
    if (!seen) throw new Refused(404, { error: 'not found' });
    if (seen.updatedAt !== request.updatedAt) {
      throw new Refused(409, { error: 'the catalogue changed since it was read', updatedAt: seen.updatedAt });
    }
    const read = gate(seen);
    if (read.length) throw refuse(read);

    /*
     * Then the drawn pages, which take seconds. Measured on the avis as
     * stored at `updatedAt`; the commit below refuses if anything was
     * saved in the meantime, so what was measured is what goes out.
     */
    if (measure) {
      let drawn: Blocker[];
      try {
        drawn = heeded(seen, (await measure(seen, brand)).filter((f) => f.weight === 'stop')).map((f) => ({ id: f.id, said: f.said }));
      } catch (error) {
        throw new Refused(422, {
          error: `siderne kunne ikke tegnes og måles før udgivelse (${error instanceof Error ? error.message : 'ukendt fejl'})`,
        });
      }
      if (drawn.length) throw refuse(drawn);
    }

    return commit(brand, id, request.updatedAt, (stored) => {
      const blockers = gate(stored);
      if (blockers.length) throw refuse(blockers);
      return { document: { ...stored, status: 'udgivet' }, label: `udgivet · ${request.who || 'ukendt'}`, owner: true };
    });
  }));

  /*
   * Taking a published avis back. It returns to "klar" with its
   * signatures, so publishing it again passes the same gate; the
   * history keeps when it was out.
   */
  app.post('/api/brand/catalogs/:id/unpublish', (c) => answer(c, async () => {
    const { brand } = c.get('brand');
    const request = await body(c, Stamp);
    return commit(brand, c.req.param('id'), request.updatedAt, (stored) => {
      if (stored.status !== 'udgivet') throw new Refused(422, { error: 'avisen er ikke udgivet' });
      return { document: { ...stored, status: 'klar' }, label: `trukket tilbage · ${request.who || 'ukendt'}`, owner: true };
    });
  }));

  /*
   * A change to a published avis: sold out, back, a new price. Checked
   * like any write — a new price the rules stop is refused, and so is a
   * stand-in put into a place sold for another product.
   */
  app.post('/api/brand/catalogs/:id/live', (c) => answer(c, async () => {
    const { brand } = c.get('brand');
    const request = await body(c, LiveRequest);
    return commit(brand, c.req.param('id'), request.updatedAt, (stored) => {
      if (stored.status !== 'udgivet') throw new Refused(422, { error: 'avisen er ikke udgivet endnu' });
      try {
        const document = applyLive(stored, request, eventId(), new Date().toISOString());
        const name = stored.offers.find((o) => o.id === request.offerId)?.name ?? request.offerId;
        return { document, label: `live · ${request.kind} · ${name}`, owner: true, check: true };
      } catch (error) {
        if (error instanceof LiveError) throw new Refused(422, { error: error.message });
        throw error;
      }
    });
  }));
}
