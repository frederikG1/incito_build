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

De fire trin er stadig vejen gennem `npm run build:catalogue`. **I
studioet er de det ikke mere.** Trin 2 planlagde en avis ud af
ingenting, og resultatet var generisk rigtigt uden at ligne kæden:
modellen blev bedt om at *opfinde* et design i stedet for at få vist et.
Kuratering kan stadig køres fra terminalen, men studioets knap er væk.

I stedet er der tre måder at få et layout på, og de koster vidt
forskelligt:

| Vej | Hvad du afleverer | Modelkald | Pris |
|---|---|---|---|
| [Hent en udgivelse](#hent-en-udgivelse-via-link) | et link til en trykt avis | ingen | 0 |
| [Genskab trykte sider](#genskab-trykte-sider) | fotos, screenshots, PDF'er | ét pr. side | $0,03–0,05 pr. side |
| [Tegn et layout](#tegn-et-layout) | ingenting — modellen tegner det | to pr. side | tegning + casting |

Den første er den eksakte: en udgivelse **oplyser sit eget gitter**, så
der er intet at gætte. De to andre får en model til at *læse* en side —
den ene en trykt en, den anden en tegnet.

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

Vælg kæde, upload ugens feed, hent eller aflevér et layout, ret, hent
PDF. **Hurtigt udkast** er den modelløse genvej: kategorier i kædens egne
layouts, til at se et feed på papir med det samme.

Et upload af feedet **læses med det samme** — kædens egen læser, gratis,
uden model — og varerne står i listen til venstre: billede, navn, pris,
grupperet som feedet grupperer dem. Se [Varelisten](#varelisten).

Editoren åbner med den fil kæden har markeret som sin prøve
(`FeedSource.sample`) — for SuperBrugsen er det `SuperBrugsenW36.json`,
hvis fotos er Republica-motiver: ét produkt, trimmet, på ingenting.
Det er hvad en flise vil have, og det er hvad der får seks varer i én
plads til at læse som seks varer.

Retningen bagefter foregår på siden, ikke i en formular. Klik en vare og
ret den som i et billedprogram:

| | |
|---|---|
| Klik | vælg varen |
| Træk | byt to varer — også på tværs af sider |
| Klik igen | tag fat i det element du peger på |
| Træk på et valgt element | flyt det |
| ⌘/ctrl + scroll, eller knib | ændr størrelsen på det |
| alt mens du trækker | slå hjælpelinjerne fra |
| Klik en vare i en klynge | tag netop den vare i hånden — se [Ret hver enkelt vare](#ret-hver-enkelt-vare-i-flisen) |
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

## Varelisten

Et upload plejede at være en streng: filen blev gemt, og det første syn
af hvad der stod i den kom flere minutter og ét modelkald senere. Nu
køres kædens egen læser med det samme, og panelet til venstre viser
varerne.

| | |
|---|---|
| Klik en vare | markér den (klik igen fjerner markeringen) |
| `+` | læg netop den vare på den valgte side |
| Klik en gruppeoverskrift | fold gruppen sammen eller ud |
| Søgefeltet | søger i navn, mærke og brødtekst |
| `s. 3` i højre kant | varen ligger allerede på side 3 |

En søgning folder alt den finder ud igen — et hit gemt inde i en foldet
gruppe er en søgning der siger "ingenting her" mens den har svaret.

Grupperingen er feedets egen kategori. En udgivelse hentet via link har
ingen kategorier — den har *sider*, og det er den eneste redaktionelle
oplysning i filen, så varerne grupperes efter hvilken side de stod på.

Nederst står to knapper, når noget er markeret. De svarer på to
forskellige spørgsmål, og kun det ene lader et trykt layout stå:

| | |
|---|---|
| **Nye pladser** | hver vare får sin egen celle — gitteret vokser om nødvendigt |
| **Saml i pladsen** | alle de markerede varer deler ÉN celle, som ét tilbud |

### Saml i pladsen

Det er sådan man lægger nye varer ind på en side hvis layout allerede er
bestemt: gitteret rører sig ikke, det er *indholdet* i cellen der
skifter. Seks oste i den plads hvor avisen har seks sodavand — én pris,
én overskrift, alle seks fotograferet sammen. Præcis det en trykt avis
kalder "frit valg".

Pladsen vælges i listen ved knappen, og den følger den flise du har
klikket på. Der er altid **én gruppe pr. plads**: at samle i en plads,
der allerede er fyldt, erstatter det der stod der — den gamle vare bliver
i avisen og går i reserve.

**Modellen sætter dem op.** Når to eller flere varer skal dele en plads,
bliver de kørt forbi Claude først — og den **ser packshottene**. Det er
hele grunden til at kaldet er værd at foretage: om seks pakker skal
vifte eller stables er en kendsgerning om hvordan de ser ud, og den står
ikke i feedet. Modellen svarer med

| | |
|---|---|
| `order` | varerne fra venstre mod højre, som de trykkes |
| `arrangement` | `row`, `stagger`, `grid` eller `fan` — de fire stylesheetet tegner |
| `heading` + `support` | de to linjer dansk under flisen |

— og **aldrig** en koordinat, en størrelse eller en farve. Cellen bliver
hvor den er, og stylesheetet tegner stadig siden. Prompten står i
`ARRANGE_SYSTEM` i `@incitio/curator`; den beskriver hvad en trykt gruppe
er (overlap, én vare forrest), hvad hver af de fire former er til, og at
en overskrift aldrig nævner en pris.

Feltet under knappen er din egen retning til modellen — "osten forrest".
Den når aldrig siden.

### Ret hver enkelt vare i flisen

En flise med flere varer tegner flere fotografier, og **hver af dem kan
tages i hånden for sig**. Klik flisen, klik varen — eller dens miniature
i panelet under **Varer i flisen** — og så svarer den de samme greb som
enhver anden kasse:

| | |
|---|---|
| Træk | flyt varen |
| ⌘/ctrl + scroll | størrelse |
| Piletaster | flyt — med shift længere |
| `[` `]` | drej den |
| `0` | tilbage hvor opstillingen satte den |
| ⌫ | tag varen ud af flisen (den kan hentes tilbage i panelet) |

En vare der er flyttet, trækkes **forrest** i stakken: den blev trukket
ud for at blive set.

**Alt hvad der trækkes, retter sig ind undervejs.** Kommer det i hånden
inden for seks pixels af at flugte med noget andet — en nabos kant, dens
midte, dens bundlinje, cellens margin, sidens midte — tager det den
nøjagtige værdi i stedet for den omtrentlige, og der tegnes en pink
linje der siger *hvorfor* det stoppede dér. Uden det er hver placering
øjemål, og en trykt side er fuld af nøjagtige forhold: fælles bundlinje,
delt midte, ens margener. Ingen af dem overlever at blive skønnet.

Hold **alt** nede for at slå det fra. Den ene gang man vil have noget
3 px ude af centrum, vil man det til gengæld gerne.

Reglen er ren geometri i `apps/studio/src/snap.ts` og den samme funktion
for alle tre slags træk — en vare i en klynge, en kasse i en flise, en
overskrift på arket. Den kender hverken procenter, dokumentet eller
hvad der trækkes; kalderen regner rettelsen om til sine egne enheder.
Pakshottet selv er med vilje undtaget: at panorere et produktbillede er
at beskære det, og en beskæring der hopper til en kant hver tredje pixel
kan ikke sættes. Rettelserne skrives på placeringen som
`overrides.pack`, nøglet på varens plads i klyngen — ikke på dens
billed-URL, for det samme foto kan optræde to gange, og en vare der
skiftes ud næste uge skal ikke efterlade en rettelse der peger på
ingenting.

De ligger som `translate`/`scale`/`rotate` og **ikke** som `transform`:
opstillingen skriver selv `transform` på de billeder — en stagger
skalerer sine ulige børn, en vifte drejer sine yderste — og en inline
`transform` ville erstatte den, så det første nøk på én vare ville
flade hele klyngen ud.

### Saml som ét fotografi

Den anden vej, og det er en anden ting — ikke en indstilling på den
første. Billedmodellen får **udklippene** og bliver bedt om ét
fotografi af varerne stående sammen: fælles gulv, én hero forrest,
resten overlappende i kanterne. Det er hvad en trykt side har, og hvad
intet stylesheet kan lave.

Prisen er det den anden vej kan: resultatet er ét billede, så varerne i
det kan ikke længere flyttes hver for sig. Det er hele byttehandlen, og
derfor findes begge.

Prompten er `clusterPrompt` i `@incitio/decor` og er **generel** — den
bygges af de varer du har valgt: antallet, hvert billede navngivet efter
sin vare og dens pakkestørrelse, og cellens eget billedformat. Alt det
øvrige er regler om hvordan en dansk avis stiller en gruppe op, og hver
linje er en fejl man ellers skulle finde i en korrektur:

- **Opgaven hedder en collage, før der bliver bedt om noget andet.**
  `CRITICAL: PIXEL-PERFECT COPYING ONLY` — ingen gentegning, ingen
  hallucination, hvert bogstav og hver stregkode identisk med kilden,
  ingen slør og ingen AI-opskalering af teksten. Det er hele feature'ens
  forudsætning: en billedmodel *gentegner* pixels, den kopierer dem
  ikke, og den er dårligst til lille skrift — et mærkenavn, en fed
  procent. På en avis er det ikke en skønhedsfejl. Kæden har kontraheret
  den grafik, og et gentegnet logo er kædens navn på et produkt den ikke
  har godkendt.
- **Kun opstillingen må ændres.** Form, farver, etikettekst, typografi,
  logoer, låg og kameravinkel skal komme ud som i referencen —
  *"treat every label as a logo that has to come out letter for letter"*.
- **Naturlige størrelser.** Referencerne er ikke i samme målestok; en
  roll-on er meget mindre end en 1000 ml shower gel. Pakkestørrelsen
  sendes med fra feedet, så den ikke skal gættes ud af et foto.
- **Ingen kontaktskygger** og hvid bund til kanten. Siderne her er
  farvede, og et udklip med skygge kan ikke lægges på dem.
- **Hver vare mindst to tredjedele synlig**, hver etiket læsbar.
- En afdeling om hvordan hver slags emballage stilles op: multipacks
  stables, flasker står på én bundlinje, poser i to forskudte rækker,
  bakker vifter ud.

Udklippene hentes som **bytes** på serveren, ikke som links — kædernes
billedtjenester signerer deres URL'er til en browser, og hver eneste
model-API dette repo har givet en af dem, har svaret at den ikke kunne
hente filen. Mangler ét udklip, afvises kaldet med navnet på den vare
det gælder: prompten navngiver *billede N* efter *vare N*, så en liste
med hul i ville sætte alle etiketter på de forkerte varer.

> Kræver `GEMINI_API_KEY` **og** fakturering på Google-projektet, som
> `npm run decorate`.

### Kør den i hånden

Faktureringen er Googles side af sagen, og at vente på den er ingen
grund til ikke at kunne se om prompten virker. Vælg flisen og tryk
**Forbered til Gemini** i panelet til højre. Så står der:

1. **prompten**, ord for ord som serveren ville have sendt den — med
   Kopiér ved siden af
2. **udklippene som filer**, nummereret `1-…`, `2-…`, `3-…` i præcis den
   rækkefølge prompten kalder dem. Filerne serveres fra vores egen
   server og ikke fra kædens billedtjeneste, fordi et link på tværs af
   domæner ikke kan bære et filnavn — og navnet er hele pointen:
   prompten siger *image 1: Klovborg skæreost*, så filen skal sige det
   samme, ellers er upload-rækkefølgen gætteri og hver etiket lander på
   den forkerte vare
3. **Brug billedet som opstilling** — den vej du vil have

Når billedet lægges på, ryddes klyngen: flisen er ét billede nu. Men
`members` bliver stående, så dokumentet stadig kan sige hvad prisen
dækker — og enhver rettelse man havde lavet vare for vare ryddes med,
i stedet for at blive hængende på indekser der ikke findes mere.

### Brug billedet som opstilling, ikke som billede

Gemini komponerer smukt og kan ikke betros en etiket. Den *gentegner*
pixels — den kopierer dem ikke — og det den er dårligst til er lige
præcis det der betyder noget her: et mærkenavn, en fed procent, den lille
skrift på et låg. Ingen prompt løser det; det er mekanismen.

Så billedet bruges ikke som billede. Det bruges som **opstilling**:
Claude får kompositionen at se og svarer med hvor hver vare endte og hvor
stor den er — fire tal, alle brøkdele af billedet — og de tal lægges på
de udklip kæden selv har leveret. Det der trykkes er den oprindelige
grafik, pixel for pixel, stående hvor kompositionen satte den.

Målt på en komposition af tre oste:

| Vare | Ønsket i billedet | Landet i cellen |
|---|---|---|
| Thise vesterhavsost | cx 0,30 · cy 0,55 · bredde 0,42 | 0,30 · 0,56 · 0,43 |
| Klovborg skæreost | 0,68 · 0,35 · 0,26 | 0,70 · 0,38 · 0,24 |
| Mammen hytteost | 0,76 · 0,72 · 0,30 | 0,74 · 0,73 · 0,27 |

— og flisens billeder peger stadig på `imageservice2.republica.dk`. Intet
fra Gemini nåede siden.

Tallene landes i `overrides.pack`, som er de samme felter din hånd
skriver i: en opstilling kan altså rettes bagefter, vare for vare, og
den samme flise kan stilles op igen uden at det hober sig op — den
nuværende skala divideres ud, så to kørsler konvergerer i stedet for at
gange sig selv.

Knappen **Læg billedet på flisen som det er** findes stadig, hvis du
vil have Geminis egne pixels. Den er ikke anbefalet, og teksten under
den siger hvorfor.

**Baggrunden skæres fra på vej ind.** Det er den ENESTE upload i
studioet der gør det: billedet er tegnet til en prompt der forlanger
hvidt helt ud til alle fire kanter, netop så det kan nøgles ud, og et
hvidt rektangel på SuperBrugsens gule læses som en renderingsfejl. Hvert
andet billede man lægger ind er fotografens eget og gemmes urørt — et
flood fill på sådan et tager himlen med.

Fyldet er `cutout` i `@incitio/decor`: flood fill **fra kanterne**, ikke
"hvid bliver gennemsigtig", så det hvide i en halveret æg og glansen på
en mandel bliver. Fandt det ingenting — `kept` tæt på 1, hvilket er hvad
en model der har tegnet et bord i stedet for et felt giver — lægges
billedet på alligevel, men du får det at vide:

> *med-baggrund.png har ingen hvid baggrund at skære fra — den lagt på
> som den er. Bed modellen om ren hvid bund helt ud til kanten.*

Prompten er strammet tilsvarende. Den bad tidligere om *"one shared
floor"*, og modellen tegnede et gulv — med skygge. Nu beder den om én
fælles **bundlinje**, *"as if standing on the same invisible line"*, og
forbyder gulv, bord, hylde, underlag, gradient, vignette, horisont,
spejling og kontaktskygge hver for sig — og siger hvad det hvide er
**til**: at varerne skal kunne skæres ud og trykkes på en farvet side.

Det samme felt virker på et fotografi du selv har lavet. Det behøver
ikke komme fra en model.

Kaldet er **aldrig bærende**. Ingen nøgle, et afvist svar, et packshot
der ikke kan hentes: så svarer serveren med stylesheetets eget valg og
siger det med `model: null`. Båndet under værktøjslinjen skriver enten
*sat op af claude-sonnet-5* eller *sat op uden model*. En flise der ikke
kunne samles fordi et API var nede, ville være et dårligere produkt end
slet intet API.

Alt der kunne blive usandt, bliver afgjort nedad — se `groupOffers`:

| | |
|---|---|
| Pris | den **laveste**, og mærket "fra" i samme øjeblik de er forskellige |
| Enhedspris | den **højeste**, hvilket er præcis hvad kædernes eget "Kg-pris maks." betyder — og slet ingen, hvis varerne ikke er kvoteret i samme enhed |
| Gyldighed | det vindue hvor de **alle** er på tilbud |
| Mærker | kun dem **hver eneste** vare bærer. Et Ø-mærke på en flise hvor én af seks ikke er økologisk er en forkert påstand, ikke en afrunding |
| Mængde | deres, hvis de er enige — ellers ingen |

Overskriften er et udkast og er lavet til at blive skrevet om: to varer
bliver "A eller B", flere tager de ord de alle begynder med. Ret den i
panelet til højre.

Hvad der sker med sidens layout, når du vælger **Nye pladser**, i den
rækkefølge:

1. **Er der tomme celler,** fyldes de — den mest fremtrædende først.
2. **Har kæden et layout med det nye antal,** flytter siden dertil. Det
   er altid den bedre side: en form nogen har tegnet.
3. **Ellers vokser sidens eget gitter** med én celle ad gangen, og en ny
   række først når der ikke er en tom celle tilbage. Det er det eneste
   der kan gøres for et layout læst af ét trykt ark — kæden har ikke
   noget andet med det antal. Skabelonen er dokumentets, aldrig kædens:
   en side der vokser, tilføjer ikke et layout til kædens ordforråd.

**Tag af siden** i panelet til højre er det modsatte, og det sletter
ikke: varen går i reserve og kan lægges ud igen. Cellen bliver stående
tom — en side man sidder og retter i, skal ikke ombryde sig selv under
hænderne på en.

## Hent en udgivelse via link

Under værktøjslinjen, i striben **Hent eller tegn sider**: sæt et link
til en trykt avis ind, og siderne kommer ned som redigerbare sider.

```
https://publication-viewer.tjek-staging.com/v1/previews/xW7ndOup?s=…
```

Det er den eneste vej ind her der **ikke koster noget og giver det samme
svar to gange**. En udgivelse serveres som et *incito*-dokument: hver
eneste vare er en kasse med koordinater, sammen med navn, pris,
brødtekst og packshot. Gitteret bliver altså **læst**, ikke vurderet —
samme gitterfitter som PDF-vejen bruger, bare med bedre bevismateriale.

Hvad der kommer med:

| Fra udgivelsen | Bliver til |
|---|---|
| varernes kasser | sidens `grid-template-areas` |
| sidens `background-color` | `page.ground` — målt, ikke gættet |
| arkets baggrundsbillede | `page.background`, med udgivelsens egen gennemsigtighed |
| navn, pris, brødtekst, packshot | `Offer[]` i dokumentet |
| "Kg-pris maks. 61,25" i brødteksten | `comparison` — enhedsprisen siden allerede trykker |

Sider uden gitter — forsider, annoncer, opskriftsopslag — kommer med som
**billedsider**, så sidetallene stemmer med den avis du sammenligner med.

`Sider` tager `4`, `1-6` eller `2,5,9`. `varerne med` kan slås fra, hvis
det er gitteret alene du vil have: varerne følger stadig med dokumentet
og ligger i reserve.

Fra terminalen:

```bash
npm run publication -- "<link>" --brand superbrugsen
npm run publication -- "<link>" --pages 1-6 --no-offers
```

> **Om adgangen:** et preview-link bærer sin egen signatur i `?s=`, og
> den signatur *er* adgangen. Uden den svarer viewer'en 401 med en note
> om scraping, og det svar sendes uændret videre til redaktøren. Et link
> der ikke er delt med os, er ikke vores at åbne.

## Tegn et layout

Ingen reference overhovedet: billedmodellen tegner en sideskitse, og
casting-trinnet læser den skitse som var det en trykt side.

**Tegningen trykkes aldrig.** Den er stillads — den bestemmer hvor
cellerne er og hvor store de er, og bliver så smidt væk. Det der lander
på arket, er kædens eget stylesheet der tegner kædens egne fliser. Det
er forskellen på det her og at klistre et genereret billede på en side.
Skitsen vises ved siden af den færdige side, præcis som en indscannet
reference gør, og af samme grund: det er den eneste måde at se om den
blev læst rigtigt.

To modeller, to opgaver, og de kan ikke byttes om:

| | model | bestemmer |
|---|---|---|
| tegningen | Gemini (billede) | **hvilken form** siden har |
| castingen | Claude (vision) | **hvilken vare** der står hvor |

`Pladser` er hvor mange celler der bedes om; feltet ved siden af er dine
egne ord, der lægges *oven i* den faste prompt og aldrig i stedet for
den. Den faste del slutter med at forbyde skrift i tegningen — en skitse
med opdigtede varenavne giver casting-trinnet noget at matche imod, som
ikke findes i feedet, og det matcher det pligtskyldigt.

```bash
npm run layout -- --brand superbrugsen --cells 6
npm run layout -- --note "én stor vare øverst" --feed ~/uge38.json
npm run layout -- --prompt-only        # se prompten, kald ingenting
```

> **Kræver fakturering hos Google**, ligesom `npm run decorate`: hver
> eneste billedmodel på Gemini-API'et er faktureringsspærret, og en
> gratis nøgle får `limit: 0` — ikke en mindre kvote. `--prompt-only`
> virker uden nogen nøgle. Casting-trinnet kræver `ANTHROPIC_API_KEY`.

## Genskab trykte sider

Tryk **Genskab sider** i topbjælken. Panelet har tre trin, og de er de tre
input pipelinen har:

| | |
|---|---|
| 1. Referencerne | fotos, screenshots eller PDF'er af de sider du vil efterligne |
| 2. Varerne | ugens feed — samme upload som til et hurtigt udkast |
| 3. Retning | én valgfri sætning, fx “kød skal føre siderne” |

Der må være flere referencer, og en PDF-række har sit eget sidefelt:
`4`, `1-6` eller `2,5,9`. Én upload af sidste uges avis bliver altså til
seks sider. Rækkefølgen i listen er rækkefølgen i avisen.

Siderne bygges **én ad gangen**, og hver side får at vide hvilke varer de
foregående allerede brugte — derfor fører den samme kaffe ikke fire
opslag. De dukker op på lærredet efterhånden som de bliver bygget, en
side der ikke kan læses koster kun den ene side, og den fil bliver
liggende i listen så den kan prøves igen.

Er der allerede en avis åben, kan **Læg siderne til** sætte de nye bagi
i stedet for at starte forfra. Varerne på de åbne sider bliver heller
ikke brugt igen.

Over hver ny side står dens egen reference på lærredet, sammen med
hvordan den blev læst: gitteret, den målte bundfarve, hvilken læser der
kørte, hvad kaldet kostede — og casting, plads for plads, med modellens
egen begrundelse for hver vare.

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
npm run match -- --ref ~/avis.pdf --page 1-6 --brand superbrugsen
npm run match -- --ref p08.jpg --ref p09.jpg --feed ~/uge38.json
```

`--ref` må gentages og `--page` tager et interval eller en liste, så en
hel avis er én kommando. Den skriver PNG, HTML og JSON til `.data/out/`
sammen med referencerne. Én side koster typisk $0.03–0.05.

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
`'hero'`. Så vokser grafikken — og kun grafikken — ud over naboen ved
siden af. Tekst og prismærker bliver i cellen.

**Grafik vokser til siden og opad, aldrig nedad.** Under enhver
packshot står dens egen varetekst, så et overløb nedad rammer typografi
hver eneste gang. Opad er der sidens egen luftgade mellem rækkerne, og
til siden står naboens packshot i samme bånd. Reglen er i
`.tile__media`, og den er ikke til pynt: da overløbet var én ensartet
`scale`, trykte alle ni varer på Nettos 3×3-side 8 px ind i deres egen
overskrift, og samtlige seks på en importeret 2×3-side ramte både deres
egen tekst og rækken ovenover. Teksten lå øverst i lagene og var derfor
læsbar — en varetekst læst gennem et fotografi er bare værre end en der
er væk, for den ser tilsigtet ud.

En celle der er højere end én række, vokser slet ikke til siden: ved
siden af den står en hel ekstra flise, og dens varenavn sidder midt i
det bånd den høje celles grafik fylder.

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

Den vigtigste regel den håndhæver: **ingen vare må trykkes oven i et
ord.** Den måler det færdige blæk mod hver eneste varetekst på siden og
siger hvilken vare der rammer hvilket navn, med hvor mange pixels. Den
afløste et regnestykke over hvor langt grafikken var "bevilget" at nå ud
over sin celle — det kunne en side med ulæselig typografi godt
tilfredsstille, og en side der var helt i orden kunne falde i det, fordi
det målte mekanismen i stedet for resultatet.

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
| `@incitio/curator` | Claude som redaktør: sideplanen (*ikke længere en vej ind fra studioet*) og `arrangeGroup`, der sætter flere varer op i én plads |
| `@incitio/decor` | Gemini: motivvalg, billedgenerering, baggrundsudklip, cache |
| `@incitio/match` | Genskab trykte sider: rasterisering, målt bund, vision-casting |
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
npm test                  # 388 tests
npm run typecheck
npm run build:catalogue   # feed → JSON + HTML + PDF
                          #   --feed <fil>  --offers N  --pages N  --source <id>
npm run render            # gen-render et bygget katalog
npm run decorate          # læg genererede stemningsbilleder på siderne
                          #   --dry  --offline  --brief "…"  --image-model <id>
                          #   --probe "<motiv>"  ét billede, uden katalog
npm run match             # genskab trykte sider med ugens varer
                          #   --ref <billede|pdf> (gentages)  --page 1-6
                          #   --feed <fil>  --note "…"
npm run publication       # hent en udgivet avis fra dens eget link
                          #   <link>  --brand <id>  --pages 1-6  --no-offers
npm run layout            # lad billedmodellen tegne layoutet, og fyld det
                          #   --cells N  --note "…"  --prompt-only
npm run refs              # hent designreferencer
npm run check             # rendér i Chromium og find afskæring
```
