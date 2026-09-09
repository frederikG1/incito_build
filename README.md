# Incitio

Turns a retailer offer feed (CSV/JSON) into a digital catalog that looks good,
then lets a human adjust it by hand.

## Quick start

```bash
npm install
npm run sample-data     # generates the stand-in feed + product cutouts
cp .env.example .env    # then put your Anthropic key in it
npm run dev:api         # http://localhost:8787
npm run dev:studio      # http://localhost:5173
```

The key is only needed for **Generér med AI**. Everything else — ingest,
selection, layout, editing, persistence — works without one, and the studio
says so rather than failing silently.

`npm test` runs the suite, `npm run typecheck` checks every package.

## How it works

```
feed ─▶ ingest ─▶ select ─▶ enrich ─▶ plan ─▶ layout ─▶ CatalogDocument ─▶ render ─▶ edit
                    ▲          ▲         ▲       ▲
                 target    image      LLM    template
                  size    profiles           library
```

One principle holds the design together: **what the catalog says (data) is
separate from how it looks (geometry), and the geometry is an explicit,
editable document.** Every AI step produces or refines a `CatalogDocument`;
the renderer and the editor both work on that same object.

The division of labour is deliberate. The LLM does the editorial judgement it
is actually good at — which offers belong together, which deserves a hero slot,
what to title a section — and emits *assignments*. It never emits coordinates.
Pixel geometry comes from a deterministic solver running against mined
templates, which is what makes the output reproducible, testable, and
correctable by hand.

## Packages

| Package | Role |
|---|---|
| `packages/schema` | Zod schemas + types. The contract everything shares. |
| `packages/ingest` | CSV/JSON → `Offer[]`. Per-retailer column mappings, messy-feed tolerance. |
| `packages/layout` | Selection, templates, scoring, constraints, solver. Pure functions, no I/O. |
| `packages/pipeline` | Composes ingest + layout. Retailer registry. One entry point: `buildCatalog`. |
| `packages/renderer` | React components: `CatalogDocument` → DOM. Shared by editor and viewer. |
| `packages/server` | Hono + `node:sqlite`. Documents, version history, image profiles. |
| `apps/studio` | Vite + React editor. |
| `ml/` | Python sidecar. `harvest.py` + `mine_templates.py` built; image profiler and scorer to come. |

**Selection** decides which offers make the catalog at all — an editorial
question that is separate from layout. nemlig's feed is a 1,235-offer range;
a leaflet publishes a fraction of it. `selectOffers` cuts to a target count
while holding a per-category ceiling, so a range heavy in one category does
not produce a drinks catalogue labelled as a supermarket. Every rejected
offer carries a reason, like ingest issues. The M4 planner replaces this
function without touching anything downstream.

## Feeds

| Retailer | Source | Offers | Images | Editorial signal |
|---|---|---|---|---|
| `sample` | generated CSV, deliberately messy | 27 | synthetic SVG | none |
| `nemlig` | DataFeedWatch XML export | 1,235 | **576px RGBA cutouts** | campaign tier |
| `superbrugsen` | Coop tilbudsavis export | 160 | **none** | page + `Priority` + `MotivType` |

`superbrugsen` is the richest feed editorially — it states which page each
offer ran on, how prominent it was, and whether its artwork is a packshot
or a lifestyle shot — and the poorest visually: it carries a `Motivid` per
offer but no URL that resolves it, so every tile renders as a placeholder.
Its offers sit two levels deep in `Pages[].Entries[]`, which is what the
`extractRows` seam on `FieldMapping` exists for.

### House-style template libraries

```bash
ml/.venv/bin/python ml/mine_templates.py --house-all
```

SuperBrugsen does not want Netto's layouts. Mining each retailer's own
pages produces a library carrying that chain's habits rather than the
average of fifty-four, written to `data/templates/house/<slug>.json`. 24
retailers have the 40+ pages needed; the rest fall back to the pooled set.

The ranges differ enough to be worth it:

| Retailer | Templates | Slots per page |
|---|---|---|
| Kvickly | 60 | 3-7 |
| Netto | 56 | 3-9 |
| SuperBrugsen | 52 | 3-10 |
| ABC Lavpris | 30 | 5-12 |
| Harald Nyborg | 60 | 3-21 |

The tradeoff is fidelity over generality: at this volume most templates are
seen once, so a house library reuses that retailer's actual page structures
rather than generalising from them.

### Uploading a feed

Drop a CSV or JSON onto the studio, or use **Upload feed**. The retailer
profile is detected from the file's field signature rather than asked for —
a retailer uploads the same shape every week, so making them re-declare it
each time is friction carrying no information. A file matching no known
profile says so and lists the fields it found, instead of guessing.

On a match the studio loads that retailer's house library and generates
immediately. Adding a retailer means one `RetailerConfig` and one signature
entry in `detect.ts`.

`scripts/convert-feed-xml.mjs <url> <out.json>` turns a DataFeedWatch XML
export into JSON, faithfully — every element keeps its original name and
nothing is coerced. Semantic mapping lives in `packages/pipeline/src/retailers.ts`
as a `FieldMapping`, so a feed's quirks never reach the catalog engine.

nemlig's `RawImage` is the project's first source of real product photography:
576x576 PNGs with a true alpha channel, so products composite into any tile.
Everything else available — Tjek offer images, page scans — arrives with the
price already printed into the picture.

## What is actually learned from real catalogs

Three things are mined from published catalogs, and they are at different
stages of being connected to what the app produces:

| Learned | Source | Wired into generation? |
|---|---|---|
| Page grids — 60 templates | 2,664 real pages (hotspots) | **Yes.** The solver picks from them. |
| Tile proportions — artwork share, type scale | 1,193 real tiles (PDFs) | **Yes.** See `MEASURED` in `OfferTile.tsx`. |
| Tile-quality CNN | 17,588 real tiles, 54 retailers | **Yes, as a judge.** `npm run score` renders the live catalog and scores every tile. |

```bash
npm run dev:studio          # in another terminal
npm run score -- --retailer nemlig
```

Playwright drives the real studio and screenshots each slot element, so the
crops come from the same renderer a person looks at — there is no second
rendering path to drift from it. The crops go to the Keras model, which
returns a verdict per tile and a roll-up per page, weakest first.

### Domain adaptation

The base model was trained on tiles cropped from published catalogs —
dense, photographic, edge to edge. Generated tiles are sparser and sit on
more white, so it had never seen the distribution it was judging and
flagged ~7% of clean generated tiles as `merged`.

```bash
npm run score -- --retailer nemlig --capture nemlig-mined   # build a corpus
ml/.venv/bin/python ml/finetune_generated.py
```

`finetune_generated.py` mixes both domains and fine-tunes at a low learning
rate, reporting each domain separately before and after — an adaptation
that fixes generated pages by forgetting published ones has traded one
blind spot for another.

| clean recall (1 - false-positive rate) | before | after |
|---|---|---|
| published, held out | 0.979 | 0.967 |
| generated, held out | 0.875 | **1.000** |
| live nemlig catalog | 11 flags / 160 | **2 flags / 160** |

Defect recall held at 0.994. `score_tiles.py` prefers
`tile_quality_finetuned.keras` when it exists.

**Still inspect `.data/scoring/tiles/` before believing a flag.** The two
survivors on the live catalog are both arguably false: one is a cat-food
box whose *packaging* pictures a cat, a bowl and food, which reasonably
reads as several overlapping objects.

## Status

- **M0 — generate and render.** Done. Feed → pages in the browser, no ML.
- **M1 — edit and persist.** Done. Drag to swap, promote to a larger slot,
  reorder pages, undo/redo, autosave to SQLite with version history.
- **M2 — template mining.** Two miners, both working.
  `mine_templates.py` learns the page grid from hotspot geometry: 2,664 real
  pages, 2,058 usable, 1,692 distinct layouts, 60 templates in
  `data/templates/mined.json`.
  `mine_pdf.py` learns tile interiors from print PDFs: 1,193 tiles across 7
  retailers in `data/templates/tile-composition.json`, plus 1,565 extracted
  product JPEGs in `.data/raw/products/` — the only source of product
  photography that exists, since API offer images are page crops with the
  price already printed in.
- **M3 — tile-quality CNN.** Trained. A from-scratch Keras/TensorFlow
  convolutional network classifies a tile as clean or as showing one of the
  rated defects. Trained on 17,588 real tiles from 54 retailers: 98.5% on
  held-out catalogs; 99.6% of defects caught, 95.7% of genuinely clean tiles
  left alone. See `ml/train_tile_quality_keras.py`.
- **M4 — LLM planner.** Built. `packages/planner` calls Claude for the
  editorial decisions — which offers share a page, which one leads it, what
  the page is called — and emits assignments only, never geometry. Run it
  with the **Generér med AI** button in the studio, or headlessly with
  `npm run generate` (`--no-ai` for the deterministic baseline). The key
  lives in the API server's environment and never reaches the browser: the
  studio POSTs offers to `/api/plan` and gets page assignments back.
- **M5 — layout scorer.** Not started. Solver already returns ranked candidates.

## Notes on the current build

The sample feed under `data/` is generated, not real. It is deliberately messy
— Danish decimal commas, semicolon delimiters, quoted fields containing
separators, a duplicate row and two broken rows — because surviving that is
ingest's actual job. Product images are generated SVG cutouts so the repo
stays self-contained and offline.

`data/` is Vite's static root, so nothing private belongs there. The database
and the raw harvest live in `.data/`.

## The ML sidecar

```bash
python3 -m venv ml/.venv && ml/.venv/bin/pip install -r ml/requirements.txt
ml/.venv/bin/python ml/harvest.py --pdfs 10   # read-only, rate-limited
ml/.venv/bin/python ml/mine_templates.py
```

`harvest.py` pulls dealers, catalogs and hotspot geometry from the Tjek public
API into `.data/raw/`, plus a spread of print PDFs (one per dealer, largest
first — six catalogs from one retailer teach you that retailer's habits, not
what a good page looks like).

`mine_templates.py` quantises hotspot rectangles onto a 12x12 grid, clusters
identical layouts, and writes the ones seen more than once to
`data/templates/mined.json`. Deterministic; no training involved. The studio
loads it at startup and falls back to the authored set if it is absent, so a
clean checkout still works with no harvest run.

## The quality model

```bash
ml/.venv/bin/python ml/harvest_pages.py --size view   # published page images
ml/.venv/bin/python ml/crop_tiles.py                  # real tiles + COCO set
ml/.venv/bin/python ml/train_tile_quality_keras.py    # train the CNN
```

**Positives are real**: 17,588 offer tiles cropped out of 4,282 published
catalog pages across 54 retailers, using hotspot rectangles for the
boundaries. The
`danish_catalogs_dataset/` COCO set folds in Lidl, fotex, Netto and REMA 1000,
including expired catalogs the live API no longer serves.

**Negatives are generated** from those same tiles by `ml/corruptions.py`, one
corruption per rated failure mode, applied fresh every epoch. Severity ratings
become class weights, so missing a dealbreaker costs three times missing a
nuisance.

**The architecture** (`ml/train_tile_quality_keras.py`) is four convolutional
blocks — two 3x3 Conv2D layers with batch normalisation, then max-pooling —
widening 32 to 256 filters, into global average pooling and a dense
classifier. 1.2M parameters, no pretrained weights. Global average pooling
rather than Flatten because a price splat can land anywhere in a tile, so the
classifier should depend on whether a feature is present, not where.

**Splits are by catalog, never by tile.** Tiles from one page share
photography, palette and typography; a per-tile split leaks them into the eval
set and reports an accuracy the model does not have. That split earned its
keep immediately: it caught a data-generation bug where the distortion
corruption added resampling blur, teaching the model that "blurry means
distorted" and flagging every genuinely good small tile. Training accuracy
hid it entirely. Fixing the corruption to resample once moved clean recall
from 0.700 to 0.918.

A PyTorch transfer-learning variant (`ml/train_tile_quality.py`, ResNet18)
exists for comparison and scores slightly higher, as expected.

`mine_pdf.py` combines both sources: a hotspot gives one offer's outer box,
the PDF gives that box's contents. It measures where the price sits relative
to the artwork, how much larger the price is set than the product name, and
how much of the tile the artwork occupies — then writes
`data/templates/tile-composition.json`. `--extract-images` additionally writes
the embedded product JPEGs out to `.data/raw/products/`.

Two limits worth knowing. It needs hotspots for tile boundaries, and 3 of the
10 sampled catalogs (MENY, Coop, Land & Fritid) have none — deriving tile
boundaries from the PDF alone would unlock those. And ~12% of extracted
JPEGs are CMYK, which needs converting before web use.
