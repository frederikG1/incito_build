/** Catalogues: list, read, save, history, workflow acts, PDF. */
import { CatalogDocument, CatalogPage, CatalogWeek, Offer, PageTemplate } from '@incitio/schema';
import type { EditOp } from '@incitio/edit/core';
import type { ApprovalRole, LiveEvent, SlotBooking } from '@incitio/schema';
import { BASE, headers, fail } from './http.js';

export type CatalogStatus = 'kladde' | 'klar' | 'udgivet' | 'skjult';

export interface CatalogSummary {
  id: string;
  brandId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  week: CatalogWeek | null;
  pages: number;
  offers: number;
  status: CatalogStatus;
  /** Roles whose signature still holds. Absent from a server older than sign-off. */
  approvals?: string[];
  /** Roles that signed, then something they answer for changed. */
  stale?: string[];
  sold?: number;
  soldFor?: number;
  live?: number;
}

/** Rename an avis, or change where it is in its week, without opening it. */
export async function patchCatalogue(
  brandId: string,
  id: string,
  patch: { name?: string; status?: CatalogStatus },
): Promise<{ updatedAt: string }> {
  const response = await fetch(`${BASE}/brand/catalogs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  if (!response.ok) await fail(response);
  return { updatedAt: ((await response.json()) as { document: { updatedAt: string } }).document.updatedAt };
}

/**
 * This chain's saved catalogues, newest first.
 *
 * The one call that makes a paid run reusable. Everything the model
 * produced is already on disk in SQLite — a rebuilt page cost real money
 * and is an ordinary document afterwards — and without a way to list
 * them the only route back to yesterday's work was to pay for it again.
 */
/** Delete an avis for good — the server refuses a published one. */
export async function deleteCatalogue(brandId: string, id: string): Promise<void> {
  const response = await fetch(`${BASE}/brand/catalogs/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers(brandId) });
  if (!response.ok) await fail(response);
}

export async function fetchCatalogues(brandId: string): Promise<CatalogSummary[]> {
  const response = await fetch(`${BASE}/brand/catalogs`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  return ((await response.json()) as { catalogs: CatalogSummary[] }).catalogs;
}

/** An avis's front page and the offers on it — what a cover on the front page is drawn from. */
export interface CatalogCover { page: CatalogPage | null; offers: Offer[]; templates: PageTemplate[] }

export async function fetchCover(brandId: string, id: string): Promise<CatalogCover> {
  const response = await fetch(`${BASE}/brand/catalogs/${encodeURIComponent(id)}/cover`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  return (await response.json()) as CatalogCover;
}

/** The catalogue was saved by somebody else after this studio last read or saved it. */
export class SaveConflict extends Error {
  constructor(readonly updatedAt: string) {
    super('Avisen er gemt af en anden imens');
  }
}

/** The server refused the save: it would break a sold place, or set a price the rules stop. Said in its words. */
export class SaveRefused extends Error {}

/** What the server keeps for itself on a save — signatures, sold places, the live log, publishing. */
export type Workflow = Pick<CatalogDocument, 'approvals' | 'bookings' | 'live' | 'status'>;

/**
 * Save, and say what the server now holds: its `updatedAt` is what the
 * next save sends as `expected`, so a save that would overwrite a
 * colleague's is refused with `SaveConflict` instead of winning quietly.
 * `force` overwrites on purpose ("gem min alligevel").
 *
 * The workflow fields are the server's: whatever this document says
 * about them, the saved one says what is stored, and `workflow` hands
 * that back so the screen can follow.
 */
export async function saveCatalogue(
  brandId: string,
  document: CatalogDocument,
  label = '',
  expected?: string,
  force = false,
): Promise<{ updatedAt: string; workflow: Workflow; kept: string[] }> {
  const query = new URLSearchParams({
    ...(label ? { label } : {}),
    ...(expected ? { expected } : {}),
    ...(force ? { force: '1' } : {}),
  }).toString();
  const response = await fetch(
    `${BASE}/brand/catalogs/${encodeURIComponent(document.id)}${query ? `?${query}` : ''}`,
    {
      method: 'PUT',
      headers: headers(brandId, { 'content-type': 'application/json' }),
      body: JSON.stringify(document),
    },
  );
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as { updatedAt?: string };
    throw new SaveConflict(body.updatedAt ?? '');
  }
  if (response.status === 422) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new SaveRefused(body.error ?? 'Serveren afviste ændringen');
  }
  if (!response.ok) await fail(response);
  const body = (await response.json()) as { document: CatalogDocument; kept?: string[] };
  const { approvals, bookings, live, status } = body.document;
  return { updatedAt: body.document.updatedAt, workflow: { approvals, bookings, live, status }, kept: body.kept ?? [] };
}

/*
 * The workflow, one act per call. Each says which version of the avis
 * it is about (`updatedAt`) and answers with the avis as now stored —
 * the server signs, sells, publishes and logs; the studio shows it.
 */
export async function act(brandId: string, id: string, path: string, method: 'POST' | 'DELETE', body?: object): Promise<CatalogDocument> {
  const response = await fetch(`${BASE}/brand/catalogs/${encodeURIComponent(id)}/${path}`, {
    method,
    headers: headers(brandId, body ? { 'content-type': 'application/json' } : {}),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 409) {
    const reply = (await response.json().catch(() => ({}))) as { updatedAt?: string; error?: string };
    // A place sold twice is a conflict too, but one with a sentence; the rest is "changed meanwhile".
    if (!reply.updatedAt && reply.error) throw new SaveRefused(reply.error);
    throw new SaveConflict(reply.updatedAt ?? '');
  }
  if (response.status === 422) {
    const reply = (await response.json().catch(() => ({}))) as { error?: string };
    throw new SaveRefused(reply.error ?? 'Serveren afviste det');
  }
  if (!response.ok) await fail(response);
  return CatalogDocument.parse(((await response.json()) as { document: unknown }).document);
}

export const stamp = (updatedAt: string) => `?updatedAt=${encodeURIComponent(updatedAt)}`;

export const approveCatalogue = (brandId: string, id: string, request: { role: ApprovalRole; who: string; updatedAt: string }) =>
  act(brandId, id, 'approvals', 'POST', request);

export const unapproveCatalogue = (brandId: string, id: string, role: ApprovalRole, updatedAt: string) =>
  act(brandId, id, `approvals/${role}${stamp(updatedAt)}`, 'DELETE');

export const bookPlace = (brandId: string, id: string, request: Omit<SlotBooking, 'id' | 'at'> & { updatedAt: string }) =>
  act(brandId, id, 'bookings', 'POST', request);

export const releasePlace = (brandId: string, id: string, bookingId: string, updatedAt: string) =>
  act(brandId, id, `bookings/${encodeURIComponent(bookingId)}${stamp(updatedAt)}`, 'DELETE');

export const publishCatalogue = (brandId: string, id: string, request: { who: string; updatedAt: string }) =>
  act(brandId, id, 'publish', 'POST', request);

export const unpublishCatalogue = (brandId: string, id: string, request: { who: string; updatedAt: string }) =>
  act(brandId, id, 'unpublish', 'POST', request);

export const sendLiveChange = (
  brandId: string,
  id: string,
  request: Pick<LiveEvent, 'kind' | 'offerId' | 'substituteId' | 'after'> & { who: string; updatedAt: string },
) => act(brandId, id, 'live', 'POST', request);

export interface CatalogueVersion { version: number; label: string; createdAt: string }

export async function fetchVersions(brandId: string, id: string): Promise<CatalogueVersion[]> {
  const response = await fetch(`${BASE}/brand/catalogs/${encodeURIComponent(id)}/versions`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  return ((await response.json()) as { versions: CatalogueVersion[] }).versions;
}

export async function fetchVersion(brandId: string, id: string, version: number): Promise<CatalogDocument> {
  const response = await fetch(
    `${BASE}/brand/catalogs/${encodeURIComponent(id)}/versions/${version}`,
    { headers: headers(brandId) },
  );
  if (!response.ok) await fail(response);
  return CatalogDocument.parse(((await response.json()) as { document: unknown }).document);
}

export async function fetchCatalogue(
  brandId: string,
  id: string,
): Promise<CatalogDocument | null> {
  const response = await fetch(`${BASE}/brand/catalogs/${encodeURIComponent(id)}`, {
    headers: headers(brandId),
  });
  if (response.status === 404) return null;
  if (!response.ok) await fail(response);
  const body = (await response.json()) as { document: unknown };
  const parsed = CatalogDocument.safeParse(body.document);
  // A stored document that no longer matches the schema is treated as
  // absent rather than crashing the editor; the caller rebuilds.
  return parsed.success ? parsed.data : null;
}

/**
 * The PDF, fetched as a blob rather than linked.
 *
 * A plain `<a href>` would drop the brand header, and the endpoint would
 * reject it — the same isolation that protects the data also means every
 * request has to be made by code that knows who it is.
 */
export async function fetchCataloguePdf(brandId: string, id: string, forPrint = false, variantId: string | null = null): Promise<Blob> {
  const params = new URLSearchParams();
  if (forPrint) params.set('tryk', '1');
  if (variantId) params.set('variant', variantId);
  const query = params.size > 0 ? `?${params}` : '';
  const response = await fetch(`${BASE}/brand/catalogs/${encodeURIComponent(id)}/pdf${query}`, {
    headers: headers(brandId),
  });
  if (!response.ok) await fail(response);
  return response.blob();
}

/* ------------------------------------------------ sig det med ord */

export interface InstructReply {
  ops: EditOp[];
  explanation: string;
  unclear: string | null;
  rejected: { op: unknown; reason: string }[];
  /** What the ops do, line by line — tried on the server before it answered. */
  applied: string[];
  /** Set when the proposal does not apply to this document. */
  error: string | null;
}

/** A sentence to edit ops, for the document on screen. Proposes; applies nothing. */
export async function instructEdit(
  brandId: string,
  request: { document: CatalogDocument; instruction: string; selection?: { offerId?: string | null; pageId?: string | null } },
): Promise<InstructReply> {
  const response = await fetch(`${BASE}/brand/instruct`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as InstructReply;
}
