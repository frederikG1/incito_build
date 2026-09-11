# Incitio

Genererer tilbudsaviser for supermarkedskæder ud fra rå produktdata.

Rå feed ind, trykklar PDF ud. Fire trin, i den rækkefølge:

```
   feed (CSV/JSON)
        │
   1. INGEST      @incitio/ingest     normaliser til Offer[]
        │                             priser, mængder, datoer, mærker
   2. KURATERING  @incitio/curator    Claude: hvad hører sammen, hvad
        │                             hedder siden, hvilket layout
   3. SKABELON    @incitio/compose    plan + kædens grid → dokument
        │         @incitio/brands
   4. RENDERING   @incitio/renderer   React → HTML/CSS
                  @incitio/pdf        Chromium → PDF
```

Ingen billedgenkendelse. Layout er deterministisk: modellen bestemmer
*hvad* der står sammen, skabelonen bestemmer *hvor* det står, og
browseren regner geometrien ud. Det er derfor output er reproducerbart,
kan diffes og kan rettes i hånden.

## Kom i gang

```bash
npm install
cp .env.example .env      # læg din ANTHROPIC_API_KEY i den
```

Byg en avis fra kommandolinjen:

```bash
npm run build:catalogue -- --brand superbrugsen --pages 6
```

Med en fil butikken har sendt, og en bestemt bestilling:

```bash
npm run build:catalogue -- --brand superbrugsen --feed ~/tilbud.json --offers 8 --pages 2
```

`--offers` siger hvor mange varer der skal med, `--pages` hvor mange
sider. Når begge er sat, fordeles varerne jævnt — 8 på 2 sider bliver
4 + 4, ikke 2 + 6.

Uden model, hvis du bare vil se maskineriet køre:

```bash
npm run build:catalogue -- --brand netto --no-ai --png
```

Alt havner i `.data/out/` som `.json`, `.html` og `.pdf`. Tilføj
`--png` for sidebilleder du kan kigge på uden en PDF-læser.

Kuratering er det dyre trin, og resultatet er et almindeligt dokument på
disken. Når du retter i skabeloner eller CSS, gen-render det i stedet
for at betale igen:

```bash
npm run render -- .data/out/superbrugsen-ai.json
```

## Studioet

```bash
npm run dev:api       # http://localhost:8787
npm run dev:studio    # http://localhost:5173
```

Vælg kæde, upload ugens feed, generér, ret, hent PDF.

Retningen bagefter foregår på siden, ikke i en formular. Klik en vare og
ret den som i et billedprogram:

| | |
|---|---|
| Klik | vælg varen |
| Træk | byt to varer — også på tværs af sider |
| Klik igen | tag fat i det element du peger på |
| Træk på et valgt element | flyt det |
| ⌘/ctrl + scroll, eller knib | ændr størrelsen på det |
| Dobbeltklik på en tekst | ret den dér hvor den står |
| Piletaster | flyt elementet — med shift længere |
| `+` `−` `0` | større, mindre, nulstil |
| ⌫ | tag elementet af siden |
| Esc / ⌘Z | slip elementet, så flisen / fortryd |

Hver synlig kasse i flisen er sit eget element — billede, pris,
certifikater, mærke, overskrift, mængde, underlinje, enhedspris,
mærkater. Billedet er ikke et særtilfælde længere, bare den kasse der
er valgt når ingen anden er. Panelet til højre lister dem alle, så en
kasse du har taget af siden kan hentes tilbage — den kan jo ikke
klikkes på.

Sidens form styres i bjælken over den:

| | |
|---|---|
| Varer | hvor mange tilbud siden bærer — resten går i reserve |
| Layout | hvilket af kædens layouts med det antal pladser |
| ⟳ | næste layout med lige så mange varer |
| Sæt i fokus | flyt den valgte vare op i sidens hovedplads |

Reserven er hvert tilbud i dokumentet som ingen side viser, og antallet
står i topbjælken. At skære en side fra otte til tre ødelægger ingenting
— sætter du den tilbage, kommer de fem igen.

Panelet til højre er den præcise halvdel af det samme: nøjagtige tal,
alle felter ét sted. Begge skriver de samme `overrides` på placeringen,
så en rettelse overlever en ny generering — og en hel træk-bevægelse er
ét tryk på ⌘Z, ikke halvtreds.

**Husk at lukke begge servere ned igen** når du er færdig.

## En kæde har flere feeds

SuperBrugsen leverer to formater, og begge er rigtige:

| Kilde | Form | Billeder |
|---|---|---|
| `tjek` | Tjeks offers-API — flad array, struktureret `pricing` og `quantity` | Det, butikkens egen udgave har |
| `coop-export` | Coops tilbudsavis-eksport, nestet i `Pages[].Entries[]` | Republica-motiver, flere varianter pr. tilbud |

Et upload matches mod kædens **egne** læsere, ikke mod alle kæders.
Passer filen ikke, siger fejlen hvilken læser der var nærmest og hvilke
felter der mangler — ikke bare "ukendt format". `--source tjek` tvinger
en bestemt læser.

**Om billederne:** de to eksempelfiler ser ens ud, men er det ikke.
`superbrugsen-tjek.json` har rene packshots fra `business_images`.
`superbrugsen-tjek-uge37.json` har *udsnit af den trykte side* — URL'en
har `x1r/y1r`-koordinater ind i `p-21.webp`. De udsnit indeholder
allerede kædens egen prisboble og brødtekst, så en genereret side med
dem viser prisen to gange. Feltet er det samme; indholdet er ikke.

## Kæder er adskilte

En Netto-medarbejder ser Netto. Ikke som et filter der lægges på til
sidst, men strukturelt:

- Hver kæde ejer sine egne skabeloner. `resolveTemplate(brand, id)` er
  den eneste måde at få fat i en skabelon på, og den kigger kun i den
  kædes eget sæt. Der findes ingen global opslagsfunktion — den ville
  være hullet.
- Alle API-ruter under `/api/brand/*` er scopede på en header, som
  middleware slår op én gang. En rute ser aldrig et kæde-id fra
  brugeren, kun den opslåede kæde.
- Databasen tager kæden med i hver eneste forespørgsel. `Store.get`
  har med vilje ingen overload uden den.
- Et upload bliver tjekket mod kædens eget feedformat og afvist hvis
  det er en anden kædes fil — ikke gættet på.

`packages/server/src/__tests__/isolation.test.ts` holder det ærligt: en
Netto-session kan ikke læse, liste, printe, overskrive eller slette
SuperBrugsens avis, heller ikke når den kender id'et.

## Sådan tilføjer du en kæde

Én fil i `packages/brands/src/brands/` og én linje i registret:

1. **Skabeloner.** Tegn griddet som det ser ud:

   ```ts
   template('netto/hero-5', 'Stort produkt med fire', [
     'hero hero hero hero b b',
     'hero hero hero hero c c',
     'd    d    d    e    e e',
   ], { hero: 'hero', b: 'standard', c: 'standard', d: 'standard', e: 'standard' })
   ```

   `areas` går direkte i `grid-template-areas`. Griddet valideres ved
   indlæsning, så en plads uden celle fejler ved opstart i stedet for at
   rendere en halv side.

2. **Tokens.** Farver og skrifter, som når DOM'en som CSS-variabler.
3. **Feed-mapping.** Hvor hvert felt bor i kædens fil.
4. **Stilblok.** Nederst i `packages/renderer/src/styles.css`, under
   `BRAND LAYER`. Kun farve, form og vægt — strukturen deles.

Giv kæden flere skabeloner ved samme antal varer. Antallet på siden
låser skabelonen, så en kæde med ét layout pr. antal trykker den samme
side igen og igen, uanset hvor klogt siderne blev planlagt.

Lad hovedvaren bryde ud af sin celle med `['hero', 1.15]` i stedet for
`'hero'`. Så vokser grafikken — og kun grafikken — ud over naboerne, som
på en trykt side hvor bakken med pålæg tydeligt ligger foran pizzaen
ovenover. Tekst og prismærker bliver i cellen; en overskrift oven i en
anden overskrift er ikke design, det er en kollision.

Skifter kæden baggrundsfarve gennem avisen, sæt `groundTints`. Mønsteret
tegnes i en tone af den aktuelle baggrund, så det bliver ens på alle
farver uden at skulle sættes op igen.

## Kontrollér renderingen

Alle afskæringsfejl i denne renderer var usynlige for TypeScript og for
unit-testene: et grid-spor der kollapsede, en procenthøjde der blev til
`auto`, et prismærke målt mod siden i stedet for felten. De viste sig
kun som et produkt med bunden skåret af.

```bash
npm run check -- .data/out/superbrugsen-baseline.json
```

Den kører rigtige Chromium, måler mod den boks der faktisk klipper, og
fortæller hvilket felt der fejler. Den rapporterer også variationen:
antal skabeloner, tætheder, baggrunde og variantopstillinger.

## Designreference

`npm run refs -- --chain Netto --pages 10` henter publicerede sider fra
Tjeks offentlige API til `.data/reference/`. Det er kigge-materiale når
man laver en kædes skabeloner — ingen kode læser det.

`--catalog <id>` henter én bestemt udgave. Id'et er det samme som
`publication_id` i en madpris.dk-URL.

Baggrundsfarverne i `groundTints` er *målt* på de sider, ikke gættet.
Gør det samme for en ny kæde.

## Pakker

| Pakke | Ansvar |
|---|---|
| `@incitio/schema` | Zod-modellen: Offer, Brand, PageTemplate, CatalogDocument |
| `@incitio/ingest` | CSV/JSON → `Offer[]`, med danske pris- og datoformater |
| `@incitio/brands` | Kæderegistret: skabeloner, tokens, feed-mapping, isolation |
| `@incitio/compose` | Udvælgelse, deterministisk plan, plan → dokument |
| `@incitio/curator` | Claude-kurateringen, med kategorisortering som fallback |
| `@incitio/renderer` | React-komponenter + stylesheet |
| `@incitio/pdf` | HTML-dokument, PDF og PNG-korrektur via Playwright |
| `@incitio/pipeline` | De fire trin bundet sammen — CLI og API bruger samme |
| `@incitio/server` | Hono-API, SQLite, kæde-scoping |
| `apps/studio` | Editoren |

## Kommandoer

```bash
npm test                  # 157 tests
npm run typecheck
npm run build:catalogue   # feed → JSON + HTML + PDF
                          #   --feed <fil>  --offers N  --pages N  --source <id>
npm run render            # gen-render et bygget katalog
npm run refs              # hent designreferencer
npm run check             # rendér i Chromium og find afskæring
```
