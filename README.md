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

   (5. STEMNING)  @incitio/decor      Gemini: motiv pr. side, genereret
                                      billede, baggrund skåret fra
```

Trin 5 er valgfrit og kører *efter* de andre, på et færdigt dokument —
se [Stemningsbilleder](#stemningsbilleder).

Ingen billedgenkendelse. Layout er deterministisk: modellen bestemmer
*hvad* der står sammen, skabelonen bestemmer *hvor* det står, og
browseren regner geometrien ud. Det er derfor output er reproducerbart,
kan diffes og kan rettes i hånden.

## Kom i gang

```bash
npm install
cp .env.example .env      # læg din ANTHROPIC_API_KEY i den
                          # GEMINI_API_KEY kun til `npm run decorate`
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

## Genskab en trykt side

Tryk **Genskab side** i topbjælken. Panelet har tre trin, og de er de tre
input pipelinen har:

| | |
|---|---|
| 1. Referencen | et foto, et screenshot eller en PDF af den side du vil efterligne |
| 2. Varerne | ugens feed — samme upload som når du bygger en hel avis |
| 3. Retning | én valgfri sætning, fx “kød skal føre siden” |

Bagefter står referencen på lærredet ved siden af den nye side, sammen
med hvordan den blev læst: gitteret, den målte bundfarve, hvilken læser
der kørte, hvad kaldet kostede — og casting, plads for plads, med
modellens egen begrundelse for hver vare.

Hvad der sker under trinnene:

1. **Referencen bliver ét billede.** En PDF rasteriseres med pdf.js inde
   i den Chromium repoet i forvejen starter for at printe. Sidens
   bundfarve *måles* i marginerne — den spørges der ikke om, for den er
   et faktum om billedet.
2. **Feedet bliver `Offer[]`** gennem kædens egen læser i
   `@incitio/ingest`. Samme vej ind som `npm run build:catalogue`; en fil
   der ikke passer til kæden afvises med hvilke felter der mangler.
3. **Claude caster.** Modellen får siden og tilbuddene i ét kald og
   svarer med et gitter, roller og hvilket tilbud der hører til hvilken
   plads. Svaret er *strukturelt* JSON — schemaet er sendt med som
   output-format, så et svar i den forkerte form er et fejlet kald, ikke
   noget parseren skal rydde op i. Modellen returnerer aldrig
   koordinater, CSS eller farver: kædens eget stylesheet tegner siden.

Ud kommer et helt almindeligt `CatalogDocument`. Editoren, gem-knappen
og PDF-knappen ved ikke at siden er kommet denne vej.

Layoutet hører ikke til kædens ordforråd — ingen har tegnet det, og det
beskriver én trykt side — så det rejser med i `document.templates` i
stedet for at lande i kædens layout-liste for altid. Det samme gælder
den målte bundfarve, som sidder på siden i `page.ground`.

Samme pipeline fra terminalen:

```bash
npm run match -- --ref .data/reference/superbrugsen/p08.jpg
npm run match -- --ref ~/avis.pdf --page 4 --brand superbrugsen
npm run match -- --ref opslag.png --feed ~/uge38.json --note "mørkere bund"
```

Den skriver PNG, HTML og JSON til `.data/out/` sammen med referencen.
Ét kald koster typisk $0.04–0.09.

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
| `@incitio/decor` | Gemini: motivvalg, billedgenerering, baggrundsudklip, cache |
| `@incitio/match` | Genskab en trykt side: rasterisering, målt bund, vision-casting |
| `@incitio/renderer` | React-komponenter + stylesheet |
| `@incitio/pdf` | HTML-dokument, PDF og PNG-korrektur via Playwright |
| `@incitio/pipeline` | De fire trin bundet sammen — CLI og API bruger samme |
| `@incitio/server` | Hono-API, SQLite, kæde-scoping |
| `apps/studio` | Editoren |

## Stemningsbilleder

En trykt avis er ikke kun packshots. SuperBrugsens egen forside lader et
fad smørrebrød løbe ud af øverste venstre hjørne bag pålægstilbuddene —
billeder der ikke sælger noget og ikke findes i noget feed.

`npm run decorate` laver dem. Den kører på et **færdigbygget** katalog og
rører ikke en eneste placering:

```bash
npm run decorate -- --probe "a loose handful of whole almonds"
npm run decorate -- .data/out/superbrugsen-baseline.json --dry
npm run decorate -- .data/out/superbrugsen-baseline.json
npm run decorate -- .data/out/superbrugsen-baseline.json --style "akvarel"
npm run render   -- .data/out/superbrugsen-baseline.json
```

To retninger, to modeller — de kan ikke byttes om:

| | går til | bestemmer |
|---|---|---|
| `--brief "efterår"` | tekstmodellen | **hvad** hver side viser |
| `--style "akvarel"` | billedmodellen | **hvordan** det tegnes |

`--style` lægges *oven i* den faste prompt, aldrig i stedet for — den
står efter håndværket og før baggrundskontrakten, så kontrakten har det
sidste ord og udklippet stadig har hvidt at skære fra. Den er også en
del af cachenøglen: omformulér, og du får en ny tegning.

I studioet er det samme to felter i striben **Stemningsbillede** under
værktøjslinjen, med *Vis den fulde prompt* der markerer dine egne ord i
den færdige prompt.

`--probe` er den mindste test: ét motiv, ét billedkald, intet katalog.
Den kører den rigtige vej — samme prompt, model, udklip og cache — og
lægger resultatet i `.data/out/probe-raw.png` og `probe-cut.png`.

Trinnet er to modelkald af meget forskellig pris:

1. **Ét tekstkald for hele bogen**, der vælger motiv pr. side — og lige
   så ofte vælger *ingenting*. Det er den halvdel der bærer: den største
   vare på SuperBrugsens p05 er Lotus toiletpapir, og et foto af
   toiletpapir er ikke stemning, det er det modsatte. Rengøring, papir,
   batterier og dyrefoder får intet. `--dry` viser valgene og genererer
   ikke noget — kør den først.
2. **Ét billedkald pr. side der overlevede**, minus alt der allerede
   ligger i cachen.

Baggrunden skæres fra i Chromium med floodfill fra kanten — ikke "hvid
bliver gennemsigtig", for det hvide i et halveret æg, glansen på en
mandel og melet på et rundstykke skal blive. Motivet lander i
`data/decor/`, navngivet efter sin prompt, så en genkørsel er et
`stat()` og ikke en regning. `--offline` bruger kun cachen.

> **Billedgenerering kræver fakturering hos Google.** En nøgle på gratis
> niveau får `limit: 0` og en 429 på *alle* billedmodeller — det ligner
> en rate limit, men er et abonnement. Tekstkaldet i trin 1 virker uden.
> `--dry` er derfor brugbar med det samme; resten kræver fakturering
> slået til på Google-projektet.
>
> Målt 14-09-2026 mod en gratis nøgle: `gemini-2.5-flash-image` og
> `gemini-3.1-flash-image` svarer begge `limit: 0`. Der er ingen gratis
> billedmodel at falde tilbage på. Når det ændrer sig, er modellen et
> miljøvariabel-skift og ikke en kodeændring — sæt `GEMINI_IMAGE_MODEL`
> i `.env`, eller `--image-model` på kommandolinjen. Studioet viser
> hvilken model der kaldes, under felterne.

## Kommandoer

```bash
npm test                  # 194 tests
npm run typecheck
npm run build:catalogue   # feed → JSON + HTML + PDF
                          #   --feed <fil>  --offers N  --pages N  --source <id>
npm run render            # gen-render et bygget katalog
npm run decorate          # læg genererede stemningsbilleder på siderne
                          #   --dry  --offline  --brief "…"  --image-model <id>
                          #   --probe "<motiv>"  ét billede, uden katalog
npm run match             # genskab én trykt side med ugens varer
                          #   --ref <billede|pdf>  --page N  --feed <fil>  --note "…"
npm run refs              # hent designreferencer
npm run check             # rendér i Chromium og find afskæring
```
