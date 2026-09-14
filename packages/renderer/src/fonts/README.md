# Typefaces

One face per chain, chosen by looking at what the chains actually print (`npm run refs -- --chain <name> --size zoom`)
rather than by picking something that felt right.

| File | Family | Chain | What settled it |
| --- | --- | --- | --- |
| `coop-400.woff2`, `coop-700.woff2` | COOP | SuperBrugsen | Not matched — **supplied**. Coop's own corporate face. |
| `rubik.woff2` | Rubik | Netto | Single-storey `g` with an open hook, `a` with a straight terminal, round dots, squared-off geometry — the uge-38 body copy. |
| `inter.woff2` | Inter | nemlig | A web shop's own register, and the one face here that was never a stand-in for print. |
| `shantellsans.woff2` | Shantell Sans | SuperBrugsen (script) | The second half of a section heading. Set against a zoom of "Stort udvalg til din fryser" and "Krone**marked**": upright rather than slanted, one stroke weight throughout, rounded terminals, single-storey `a`, `g` with an open unlooped descender. Caveat leans and thins; Patrick Hand matches the skeleton but ships no weight axis. |

## Two kinds of file live here

**Rubik, Inter and Shantell Sans are stand-ins.** Each is an SIL Open
Font License face matched to a chain's printed letterforms — the same
skeleton, not the same drawing. Swapping one for the real thing is a
change to the brand's `headingFont`/`bodyFont`/`scriptFont` tokens and
dropping a file in here; nothing else in the pipeline knows a font name.
Each is the `latin` subset as a variable font covering the weights the
stylesheet spends — 400–900 for the groteskes, 300–800 for Shantell Sans.

**COOP is the real face**, and it is the worked example of what the
paragraph above describes. It replaced Nunito Sans, which had been
picked by eye off the week-37 book and was a decent likeness. The test
that separated them was not letterforms but metrics: set at the book's
own size, COOP breaks

> Lotus Comfort toiletpapir / eller Premium køkkenrulle

after `toiletpapir` exactly as p05 does, and runs

> 613-736 g. Kg-pris maks. 32,63.

to within a pixel of the printed line's width. A look-alike matches the
shapes; only the face itself matches where the lines break. If you are
ever unsure whether a supplied file is the genuine article, set a real
caption at the real size and compare line endings — it is a far sharper
instrument than staring at an `a`.

Two static weights, 400 and 700, which is all Coop ships. The
`@font-face` ranges in `styles.css` declare them as `400 600` and
`700 900` so the stylesheet's 500, 800 and 900 each resolve onto a
drawing that exists instead of onto a synthetic bold.

## Licensing

Rubik, Inter and Shantell Sans are SIL OFL 1.1, downloaded from Google
Fonts; licences at https://github.com/google/fonts.

**COOP is not open, and is not ours.** Its embedded EULA (name ID 13)
reads in part: Coop Danmark A/S holds a lifetime *exclusive* licence,
the software "may not be sublicensed, sold, leased, rented, lent, or
given away to another person or entity," and Coop "may extend the
licence to third party, provided that third party comply to the
conditions of this Agreement." Shipping it here rests on that extension
clause and on our engagement with Coop — not on anything in this
repository. Two things follow:

- **It must not leave a Coop context.** `pdf/src/html.ts` inlines only
  the faces the rendering brand's tokens name, so a Netto or nemlig
  proof carries no COOP bytes. Do not go back to inlining every face.
- **If the engagement ends, this file goes with it.** Deleting
  `coop-*.woff2` and pointing SuperBrugsen's tokens back at an OFL
  stand-in is a two-line change; that is the whole reason the tokens
  exist.

Latin-1 covers æ, ø and å, so Danish needs no extended subset from any
of these.
