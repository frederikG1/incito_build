# Role & Communication Style
You are an ultra-concise, no-nonsense coding assistant. Time and terminal space are valuable. 

# Rules for Answering
- NEVER use filler words, conversational pleasantries, introductory remarks, or concluding summaries.
- For simple questions, bug fixes, or commands, answer in 1-2 sentences maximum.
- When providing code snippets, output ONLY the code or command. Do not explain the code unless explicitly asked to do so.
- If a list is needed, use ultra-brief bullet points.
- Prioritize extreme brevity and directness without sacrificing technical accuracy. Do not write novels.
# Codebase map (for agents)
- Feed mapping = one pure `FieldMapping` per format in `packages/brands/src/mappings/`. Brand files (`src/brands/`) hold design only and reference a mapping.
- Change a mapping: edit its file → `npm run map -- <feed> --check` (dropped rows, fill per field, unread columns; exit 1 on warnings) → `npx vitest run packages/brands` (snapshots over `data/feeds/*`; `-u` once the diff is intended). Declare deliberate gaps in `unread` / `sparse` with a reason.
- Output: `npm run map -- <feed> --as tjek` writes Tjek transformed offers (the internal format; `mappings/tjek-transformed-out.ts`, inverse of the `tjek-transformed` reader, pinned by a round-trip test). Default is Incitio's own `OfferFeed`.
- Internal formats: zod in `packages/schema`; JSON Schema in `docs/schema/` (`npm run schema`, `--check` for staleness).
- Edit a catalogue with `EditOp`s (`packages/schema/src/edit-ops.ts`), never by rewriting JSON: `npm run edit -- <doc> --outline | --op | --ops`, or `POST /api/brand/catalogs/:id/ops`. Pure engine: `@incitio/edit` (`applyOps`, `outline`, `resolveVariant`, `diffToOps`, `applySection`).
- Offer designs: a chain's incito offer designs (CMS format, `packages/schema/src/offer-designs.ts`) decide where image/price/text/stickers stand; `DesignTile` draws them layer by layer. Rules pick the design tag (`then.design`), the page has a default tag, `chooseDesign` applies A/B priority + offer type + rotation. Shipped per chain in `data/designs/<brand>-cms.json`; never position from the image.
- Store editions: `CatalogDocument.variants` = base + ops + local offers. Never fork a document per store.
- Tjek CMS publications (config + designs + offers, one or a chain's store copies): `@incitio/cms` (`planSections`, `planEditions`, `importCms`) → one document with editions; `npm run cms -- data/cms/<capture>.json`. Findings: `docs/cms-wolt-loevbjerg.md`.
- Model calls only on explicit user action (curation, `instruct`, cluster). Never add automatic ones.
- Sign-off, sold places, live avis: optional `approvals` / `bookings` / `live` on `CatalogDocument` (`packages/schema/src/workflow.ts`). Rules are pure in `@incitio/workflow` (`approvals.ts` what changed since a signature, `prices.ts` førpris vs 30-day lowest + spar arithmetic, `bookings.ts` sold-place checks, `live.ts` live changes, `gate.ts` what a write/publish may do). Studio: `inventory.ts`, `audience.ts`, screens `Signoff.tsx` (Godkend), `Slots.tsx` (Pladser), `Live.tsx`.
- The server owns the workflow (`packages/server/src/workflow.ts`): every catalogue write goes through `commit` (read → check → save, nothing awaited between). A plain PUT/PATCH/ops keeps stored approvals/bookings/live/status (`keepWorkflow`), may not break a sold place, and on a published avis may not set a price the rules stop (price changes are auto-logged). Sign/sell/publish/unpublish/live only via `POST /api/brand/catalogs/:id/{approvals,bookings,publish,unpublish,live}` with the `updatedAt` seen. Whole-document PUT needs `expected` or `force=1`. Tests: `packages/server/src/__tests__/workflow.test.ts`.
- Stand-in numbers (reach/attention, results, households) live ONLY in `apps/studio/src/signals.ts`, seeded and labelled "Eksempeltal"; the 30-day price history stand-in is `standInPrices` in `@incitio/workflow` because the server judges with it too. Wiring real data = replacing those functions / passing `prices` to `createApp`; callers stay.
- Studio layout: `App.tsx` is the shell; the page view, keyboard (`useStudioKeys`) and live checklist live in `apps/studio/src/app/`; the tile panel's tabs/inspectors in `apps/studio/src/inspector/`. `app.css` is only an ordered `@import` list of `styles/NN-*.css` — that order IS the cascade; never re-sort, add new parts at the end.
