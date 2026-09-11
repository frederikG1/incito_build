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
