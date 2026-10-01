# Incitio — kort fortalt

Vi laver tilbudsaviser ud fra rå produktdata. Feed ind, trykklar PDF ud.

## Den korte version

> Vi får en tilbudsfil fra kæden. Først normaliserer vi den til vores eget
> format, og så skærer vi den ned rent deterministisk — kun tilbud med
> billede, max en fjerdedel fra samme kategori — så vi står med fx 60
> tilbud i stedet for 1.200.
>
> Dem sender vi til Claude, som er **redaktøren**: den bestemmer hvilke
> tilbud der hører sammen på en side, hvad siden hedder, hvilket tilbud
> der fører, og hvilket af kædens egne layouts der skal bruges. Den rører
> ikke design — ingen koordinater, ingen CSS, kun id'er og et template-id.
> Vi validerer bagefter, så den ikke kan finde på tilbud eller låne et
> layout fra en anden kæde.
>
> Så sætter vi planen sammen med skabelonen, renderer med de samme
> React-komponenter som editoren bruger, og printer med Chromium.
>
> Pointen er at det kreative ligger ét sted — *hvad hører sammen* — mens
> layoutet er fast og kædeejet. Derfor er output reproducerbart og kan
> rettes i hånden bagefter.

Én sætning: **feed ind → vi skærer ned → Claude lægger sideplanen →
kædens egne skabeloner og Chromium laver PDF'en.**

## De fire trin

```
   feed (CSV/JSON)
        │
   1. INGEST       normaliser til Offer[] — priser, mængder, datoer, mærker
        │          + deterministisk udvælgelse ned til sidebudgettet
   2. KURATERING   Claude: hvad hører sammen, hvad hedder siden,
        │          hvilket layout, hvilket tilbud fører
   3. KOMPOSITION  plan + kædens grid → ét katalogdokument (JSON)
        │
   4. RENDERING    React → HTML/CSS → Chromium → PDF + PNG
```

Ingen billedgenkendelse, ingen Python. Modellen bestemmer *hvad* der står
sammen, skabelonen bestemmer *hvor* det står, og browseren regner
geometrien ud.

De fire trin bor i `@incitio/ingest`, `@incitio/curator`, `@incitio/compose`
og `@incitio/renderer` + `@incitio/pdf`. De er bundet sammen ét sted —
`buildCatalogue()` i `@incitio/pipeline` — så CLI, API og tests ikke kan
drifte fra hinanden.

## Tre ting der er værd at vide

**Vi skærer ned før modellen, ikke efter.** Hvert tilbud der sendes til
Claude står i prompten, så en hel varekatalog på 1.235 rækker ville være
et stort kald for at lave seks sider. Udvælgelsen er samtidig grunden til
at modellen planlægger en avis i stedet for at lave kædens indkøb.

**Vi tror ikke på det modellen siger.** Opfundne varenumre droppes,
gentagelser droppes, et layout fra en anden kæde erstattes med et der
passer i størrelse, sideloftet håndhæves i kode, og glemte tilbud fyldes
ind bagefter. Fejler API'et, falder den tilbage på en kategorisortering
med en læsbar årsag — en avis der udkommer slår en avis der venter.

**Kæder er adskilte strukturelt.** Der findes ingen global
skabelonopslagsfunktion; man kan kun slå et layout op *inden for* én kæde.
En Netto-session kan ikke se, printe eller overskrive SuperBrugsens avis,
heller ikke med id'et i hånden.

## Opgaven, punkt for punkt

Oplægget bad om fire ting. Sådan ser de ud i koden:

| Krav | Hvor | Prøv |
|---|---|---|
| **Let feed-pipeline** — fil ind, mapper, vores format ud | `@incitio/ingest` (`normalizeRows`, CSV/JSON/XML) + én fil pr. mapping i `packages/brands/src/mappings/` | `npm run map -- data/feeds/SuperBrugsenW36.json --as tjek` (Tjeks transformed offers) |
| **Claude kan lave og validere mappingen** | `--check`: tabte rækker med årsag, udfyldning pr. felt, kolonner mappingen aldrig læser. Snapshot-test over hver fil i `data/feeds`. JSON Schema i `docs/schema/` | `npm run map -- data/feeds/nemlig.json --check` |
| **Fælles designs** | Sektioner er versionerede og *refereres* fra siden (`CatalogPage.section`). Gem en ny version, og siderne der bruger den tilbydes det nye design med deres varer | ⋯ på en side → Opdatér «sektion» for alle |
| **Lokale udgaver** | Én avis + pr. butik en kort liste ændringer (`PublicationVariant`). Rettes basen, når det alle butikker | Udgave ▾ i topbjælken |
| **Varedesigns (som CMS'ets)** | Kædens egne offer designs, hentet fra Tjek CMS: faste felter til billede, pris, besparelse, tekst og mærker. Regler vælger design (har ikke billede → «… Uden billede»), designet bestemmer hvor alt står. Kan rettes i studiet og kopieres tilbage til CMS'et | ⌘K → Varedesigns |
| **Sider der ikke ligner et gitter** | Flise-varianter, bleed, klynger (række/forskudt/vifte), målte celler fra trykte sider, dekorationer | se den store README |
| **Finjustering oven på det genererede** | Hver kasse i en flise kan flyttes/skaleres/omskrives; låste varer står fast til næste uge | klik, træk, `⌘`+scroll |
| **AI-venlig redigering** | Én ordliste, `EditOp`, som studiet, API'et, CLI'en og Claude taler. `outline` er avisen i få linjer | `⌘K` → skriv en ændring → Spørg AI |

### Udgaver, konkret

Biltemas "Alt til en god september" er i Tjeks CMS **19 udgivelser** —
én pr. butik — holdt i takt med knapper der kopierer design og config fra
den ene til de andre. Forskellen mellem Næstved og Holbæk er én vare
(affaldsposer, 8,90) i én sektion. Her er det én avis og:

```json
{ "id": "holbaek", "name": "Holbæk", "stores": ["auto-generated-for-store-415"],
  "offers": [{ "id": "262023", "name": "Affaldspose 30 liter, 20-pak", "price": 8.9, … }],
  "ops": [{ "op": "add", "offerId": "262023", "pageId": "miljo-nederst" }] }
```

Udgaven regnes ud fra basen hver gang, så en rettelse i basen når alle
butikker. En ændring der ikke længere passer (varen er væk fra basen),
springes over og vises — den forsvinder ikke i stilhed. Det man retter
mens en udgave er åben, gemmes som ops (`diffToOps`), ikke som en kopi.

### Redigér uden studiet

```bash
npm run edit -- avis.json --outline                     # avisen i linjer: sider, felter, varer, reserve
npm run edit -- avis.json --op '{"op":"lead","offerId":"1073780"}'
npm run edit -- avis.json --say "byt pizzaen og kyllingen"   # ét modelkald, viser forslaget
npm run edit -- avis.json --say "…" --apply
```

Samme ops over HTTP: `GET /api/brand/catalogs/:id/outline`,
`POST /api/brand/catalogs/:id/ops` (alt eller intet, gemmes som version),
begge med `?variant=holbaek` for én butik. Ordlisten er
`docs/schema/edit-ops.schema.json`.

## Prøv det

```bash
npm install
cp .env.example .env      # ANTHROPIC_API_KEY ind i den
npm run build:catalogue -- --brand superbrugsen --pages 6
```

Uden model, hvis du bare vil se maskineriet køre:

```bash
npm run build:catalogue -- --brand netto --no-ai --png
```

Alt havner i `.data/out/` som `.json`, `.html` og `.pdf`. Kuratering er det
dyre trin, og resultatet er et almindeligt dokument på disken — så når du
retter i skabeloner eller CSS, gen-render i stedet for at betale igen:

```bash
npm run render -- .data/out/superbrugsen-ai.json
```

Editoren er `npm run dev:api` + `npm run dev:studio`. Vælg kæde, upload
ugens feed, generér, ret i hånden, hent PDF.

Flere detaljer i [den store README](../README.md).
