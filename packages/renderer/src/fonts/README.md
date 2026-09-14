# Typefaces

Four faces, chosen by looking at what the chains actually print (`npm run refs -- --chain <name> --size zoom`) rather
than by picking something that felt right.

| File | Family | Chain | What settled it |
| --- | --- | --- | --- |
| `nunitosans.woff2` | Nunito Sans | SuperBrugsen | The `a` carries a curved exit stroke and the `t` is cut at an angle, which is what the week-37 headlines do. Wide, round, generous counters. |
| `rubik.woff2` | Rubik | Netto | Single-storey `g` with an open hook, `a` with a straight terminal, round dots, squared-off geometry — the uge-38 body copy. |
| `inter.woff2` | Inter | nemlig | A web shop's own register, and the one face here that was never a stand-in for print. |
| `shantellsans.woff2` | Shantell Sans | SuperBrugsen (script) | The second half of a section heading. Set against a zoom of "Stort udvalg til din fryser" and "Krone**marked**": upright rather than slanted, one stroke weight throughout, rounded terminals, single-storey `a`, `g` with an open unlooped descender. Caveat leans and thins; Patrick Hand matches the skeleton but ships no weight axis. |

**These are not the chains' licensed corporate faces.** Those are
commercial and cannot be shipped in a repository. Each of these is an
SIL Open Font License face matched to the printed letterforms — the same
skeleton, not the same drawing. Swapping one for the real thing is a
change to the brand's `headingFont`/`bodyFont`/`scriptFont` tokens and
dropping a file in here; nothing else in the pipeline knows a font name.

Each file is the `latin` subset as a variable font covering the weights
the stylesheet spends — 400–900 for the three groteskes (400, 500, 700,
800, 900), 300–800 for Shantell Sans (600 for a subtitle, 700 beside a
heading).
Latin covers æ, ø and å — they live in Latin-1, not in an extended
subset — so Danish needs nothing further.

Downloaded from Google Fonts; licences at
https://github.com/google/fonts (SIL OFL 1.1 for all four).
