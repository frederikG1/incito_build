# Tailwind-udkastet til OfferTile

`OfferTile.tailwind-draft.tsx` er et udkast der skrev tilen om til
Tailwind-utility-klasser. Det er gemt her fordi designintentionen i det
er rigtig og blev ført videre — ikke fordi filen kan køre.

Den kan ikke køre, af tre grunde:

1. **Tailwind er ikke installeret** i dette workspace, og der er ingen
   build der genererer utility-klasserne. Klasserne rammer ingenting.
2. Udkastet fjerner de semantiske klasser (`tile__media`, `price__figure`,
   `tile__info` …) som `packages/renderer/src/styles.css` er bygget på.
   Stylesheetet er hele print-designet, så siden renderede uden layout.
3. To ting i udkastet ville også være forkerte med Tailwind installeret:
   - `bg-[#c31314]` hardkoder Coop-rød i tilen. Prisboblen skal tage
     farve fra `var(--brand)`, ellers får Nettos side Coops rød — se
     "Kæder er adskilte" i README.
   - `h-40` er 160 faste pixels. Hele designet er skrevet i `cqh`/`cqw`
     mod siden, så det skalerer ens på skærm og i A4-PDF'en. En fast
     px-højde giver 160 px grafik på et 300 dpi-ark.

Intentionen — kæmpe priser, boblen som klistermærke på billedets hjørne,
førpris lille og streget tæt på — er gennemført i `styles.css`.
