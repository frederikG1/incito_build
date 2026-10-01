# Wolt og Løvbjerg i Tjek CMS — hvad de er lavet af, og hvad vi gør med det

Læst ud af CMS'et (staging, 1. oktober 2026): Wolt Market uge 16 og
Løvbjerg uge 16 + 17 — hovedavis og alle 18 butikker begge uger. Råfilerne
ligger i `data/cms/`; `npm run cms -- <fil>` gentager hele gennemgangen.

## Sådan er en CMS-avis bygget

En publikation er fire svar fra CMS'et:

| Del | Hvad den siger |
|---|---|
| **config** | Sektionerne i rækkefølge: titel, *cohort* (feed-kategori), main- og overflow-sektionsdesign, tilbud, A-tilbud |
| **sektionsdesigns** | Et ark af lag — baggrund, overskrift, billeder — og én eller flere **tilbudsbokse**: «tegn med tilbudsdesign X, højst N stk.». En boks uden N tager resten |
| **tilbudsdesigns** | Hvor billede, pris, tekst og mærker står, pr. tag — med en version pr. pristype (medlemspris, «2 for», procent) og A/B |
| **tilbud** | Transformed-formatet (som `tjekTransformed` allerede læser), nøglet på kædens varenummer, med `col_locks` for felter der er rettet i hånden |

Har en sektion flere tilbud end main-designet kan rumme, fortsætter de på
overflow-designet, side efter side.

## Wolt

- Én national avis. **32 sektioner = feedets kategorier** (Økologi, Ost, Vin …).
- Næsten alle: `Primary - Main` (5 tilbud) + `Primary - Overflow` (resten). Økologi
  med 7 tilbud bliver 2 sider (5 + 2).
- Ét tilbudsdesign, **«Design 1», i en version pr. pristype** + en mørk «Dmode» og
  livsstilsvarianten «Design 2». Tilbuddene står på et cremefarvet panel, som er
  sektionsdesignets tilbudsboks — ikke tilbudsdesignet.
- 23 sektionsdesigns, 12 i brug. 13 tilbudsdesigns.

## Løvbjerg

- **19 publikationer om ugen**: en «Hovedavis» og en kopi pr. butik.
- **En butiks avis = fælles avis − «Lokale sider» + 3–21 egne tilbud**, alle i
  «JA TAK»-sektionen — butikkens egne opslag i Facebook-tone («😍‼️ JA TAK ‼️😍
  2 kg sandwich kylling, afhentning onsdag»). Ellers er de 18 butikker ens.
- **Kopierne glider fra hinanden**: i uge 16 har fire butikker ændret et design i
  deres egen kopi (Brønderslev, Ikast, Viborg Sct. Mathias, Varde). Ugen efter er
  det væk, medmindre nogen kopierer det med.
- **Uge til uge**: 34 af 37 sektioner genbruges, men kun 12 med samme design samme
  sted, og 160 af 173 tilbud er nye.
- **Håndarbejde**: 161 af 167 tilbud har låste felter — billedet på 160. Feedets
  billeder skiftes i hånden hver uge.
- 56–69 sektionsdesigns (27 i brug), 73–77 tilbudsdesigns (20–25 i brug).
  «Hele menukortet» peger på et sektionsdesign, publikationen ikke har.
- 12 procenttilbud («Spar 25% på Øllingegaard») har ingen pris.

## Hvad vi har taget med

| | Hvor |
|---|---|
| CMS-publikationer → én avis med udgaver | `@incitio/cms` (`importCms`), `npm run cms` |
| Sektion → tilbudsbokse, kapacitet, main- og overflow-sider, baggrund | `planSections` |
| Mange kopier → fælles udgave + hver kopis afvigelse, fælles ændringer, drift | `planEditions` |
| Udgaver der er forskellige på sideniveau | ny op `removePage`; `add` vokser i dokumentets egne gitre |
| Wolts «2 for»-design | `get_x_for_y` i `OFFER_TYPES` |
| Løvbjerg og Wolt som kæder med deres egne CMS-tilbudsdesigns | `brands/loevbjerg.ts`, `brands/wolt.ts`, `data/designs/*-cms.json` |
| Tilbudsdesigns læst tilbage fra en renderet avis | `@incitio/publication` `designs.ts` — Wolt: 114 af 115 felter til rette design |

**I studiet:** `npm run cms -- <fil> --save` gemmer avisen under kæden. Løvbjerg
uge 17 åbner med «Alle butikker» + Hovedavis og 18 butikker under «Udgave ▾»
(Brønderslev +21 varer …). Sider uden tilbud — forsiden, «Din butik har egen
lokal avis» — står præcis som CMS'et tegnede dem; tilbudssiderne tegnes med
kædens egne tilbudsdesigns på sektionens baggrund.

**Resultatet for Løvbjerg:** 38 publikationer bliver 2 dokumenter. Hver uge
er en fælles avis plus 19 udgaver på i alt 254 ops — typisk én `removePage`
og butikkens egne `add`. Alle 19 udgaver genskabes præcist (sider og tilbud pr.
sektion) begge uger, og testen holder det fast.

## Hvad vi gør bedre end CMS'et

1. **Én avis, ikke 19 kopier.** En rettelse i den fælles avis når alle butikker. En
   butik kan ikke komme til at glide fra de andre uden at det ses.
2. **Ens ændringer står ét sted.** At alle butikker dropper «Lokale sider», er i
   dag 18 manuelle kopier. Her er det synligt som én fælles forskel.
3. **JA TAK er butikkens egen liste.** Butikken skriver kun sine egne tilbud, ikke
   en hel avis.
4. **Drift bliver en advarsel.** En butiks egen designændring vises i rapporten i
   stedet for at forsvinde næste uge.

## Hvad mangler

- **Sektionsdesigns tegnes ikke.** Siden får designets baggrundsbillede og farve,
  men ikke dets overskrifter, billeder og stiplede linjer. Og én side har ét
  tilbudsdesign, mens Løvbjerg giver lead-boksen sit eget («lang prio»). Næste
  skridt er et tilbudsdesign pr. felt.
- **Tilbud uden pris** (procenttilbud) kan ikke blive `Offer`, fordi `price` er
  påkrævet. De rapporteres, men vises ikke.
- **Låste felter bør huskes pr. varenummer på tværs af uger.** Så skal Løvbjergs
  160 billeder ikke skiftes i hånden hver uge.
- **Kædernes egne skrifter** ligger i CMS-configen (woff2/otf), men er ikke hentet
  endnu. Indtil da bruges en erstatning, og én test fejler bevidst.
- **Hentningen er manuel.** Data er læst fra CMS'ets egne svar i browseren. Med en
  API-nøgle kan det blive et kald.
