import { useState } from 'react';
import type { Offer } from '@incitio/schema';
import { PLACE_PROMPTS, placePrompt } from '@incitio/curator/place-prompt';
import { useStudio, useStudioPick } from '../state.js';
import { priceOf, saidPrice } from '../price.js';

/** Standing a cluster's products up — by AI, or from a picture of your own. */
export function ArrangePanel({ offer }: { offer: Offer }) {
  const { busy, decorReady, splitAndStandUp, standUpOneCluster, clusterWay, setClusterWay, clusterImageModel, setClusterImageModel, clusterRun, clusterPlaceModel, setClusterPlaceModel, clusterPrompt, setClusterPrompt, promptRuns, placeStrict, setPlaceStrict, clusterPromptId, setClusterPromptId, ghosts, toggleGhost, applyClusterLayout, setTileImage } = useStudioPick('busy', 'decorReady', 'splitAndStandUp', 'standUpOneCluster', 'clusterWay', 'setClusterWay', 'clusterImageModel', 'setClusterImageModel', 'clusterRun', 'clusterPlaceModel', 'setClusterPlaceModel', 'clusterPrompt', 'setClusterPrompt', 'promptRuns', 'placeStrict', 'setPlaceStrict', 'clusterPromptId', 'setClusterPromptId', 'ghosts', 'toggleGhost', 'applyClusterLayout', 'setTileImage');
  // Shut by default: the prompt is three hundred words, and most
  // sessions never open it.
  const [showPrompt, setShowPrompt] = useState(false);
  return (
    <>
      {/*
        * The products inside a cluster, when the tile draws one.
        *
        * Listed for the same reason the boxes above are: a variant
        * taken off the page cannot be clicked to get it back. It is
        * also the only place the pack's order is visible, which is what
        * decides who stands at the front — see the stacking note in
        * `OfferTile`.
        */}
      {/*
        * Running the composition by hand.
        *
        * The image model is billing-gated on Google's side, and waiting
        * for a billing account is not a reason to be unable to see
        * whether the prompt works. Everything here exists so the same
        * job can be done in Gemini's own app: the prompt as the server
        * would have sent it, the cutouts numbered in the order the
        * prompt names them, and a way back in for the result.
        */}
      {/*
        * One picture, several variants — three bottles in one packshot.
        * The arrangement below works on separate cutouts, so this cuts
        * the picture into one per variant first, then stands them up.
        */}
      {offer.members.length <= 1 && (offer.imageUrl || offer.imagePack.length > 1) && (
        <div className="way way--split">
          <h3 className="inspector__group">Opstilling</h3>
          <button
            className="way__go"
            disabled={Boolean(busy) || !decorReady}
            title={decorReady ? 'AI stiller varerne i billedet pænt op (G)' : 'AI-hjælpen er slået fra på denne maskine'}
            onClick={() => void splitAndStandUp(offer.id)}
          >
            Stil varerne pænt op
          </button>
          <p className="way__aside">Hver vare kan bagefter flyttes for sig.</p>
        </div>
      )}

      {offer.members.length > 1 && (
        <>
          <h3 className="inspector__group">Opstilling</h3>

          {/*
            * One box, because it is one decision with one button.
            *
            * Gemini does both jobs here now: the arrangement is asked
            * for as numbers from a text-and-vision model, which has a
            * free tier, and only the round trip reaches an image
            * model, which does not. The controls say which is which,
            * and the line after a run says what actually happened —
            * including when a busy model handed the job on.
            */}
          <div className="way">
            <button
              className="way__go"
              disabled={Boolean(busy) || (clusterWay === 'rundtur' && !decorReady)}
              title={clusterWay === 'rundtur' && !decorReady
                ? 'AI-hjælpen er slået fra på denne maskine'
                : 'AI stiller varerne pænt op (G)'}
              onClick={() => void standUpOneCluster(offer.id)}
            >
              Stil varerne pænt op
            </button>
            <p className="way__aside">Hver vare kan bagefter flyttes for sig.</p>

            {/* Model, method, prompt and the numbers from the last run —
                for whoever is tuning the arrangement, not for the week's paper. */}
            <details className="way__more">
            <summary>Avanceret</summary>
            <label className="way__field">
              <span>Metode</span>
              <select
                value={clusterWay}
                onChange={(event) => setClusterWay(event.target.value as typeof clusterWay)}
              >
                <option value="koordinater">Koordinater — ét kald, intet billede</option>
                <option value="rundtur">Rundtur — tegn billedet og mål det</option>
              </select>
            </label>

            {clusterWay === 'koordinater' ? (
              <label className="way__field">
                <span>Opstillingsmodel</span>
                <select
                  value={clusterPlaceModel}
                  onChange={(event) => setClusterPlaceModel(event.target.value)}
                >
                  <option value="">gemini-3.8-flash — standard</option>
                  <option value="gemini-3.7-flash">gemini-3.7-flash</option>
                  <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                  <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite — hurtigst</option>
                </select>
                {/*
                  * Whether a busy model may be stepped over.
                  *
                  * On by default here, because the whole reason to
                  * pick a model is to see what THAT model does — and
                  * a reserve that quietly answers instead turns the
                  * comparison into a comparison of nothing. Measured:
                  * two runs asking for 3.8-flash took 49 s and 67 s
                  * and were both answered by flash-lite.
                  */}
                <label className="way__strict" title={placeStrict
                  ? 'Kun den valgte model svarer. Er den optaget, fejler kørslen og siger det.'
                  : 'Er den valgte model optaget, svarer den næste i rækken i stedet'}>
                  <input
                    type="checkbox"
                    checked={placeStrict}
                    onChange={(event) => setPlaceStrict(event.target.checked)}
                  />
                  <span>kun denne model — ingen reserve</span>
                </label>
              </label>
            ) : (
              <label className="way__field">
                <span>Billedmodel</span>
                <select
                  value={clusterImageModel}
                  onChange={(event) => setClusterImageModel(event.target.value)}
                >
                  <option value="">Serverens standard</option>
                  <option value="gemini-3.1-flash-image">gemini-3.1-flash-image</option>
                  <option value="gemini-3-pro-image">gemini-3-pro-image</option>
                  <option value="nano-banana-pro-preview">nano-banana-pro-preview</option>
                </select>
              </label>
            )}

            <p className="way__aside">
              {clusterWay === 'koordinater'
                ? 'Gemini ser udklippene og siger hvor hver vare skal stå. Tekstmodellen'
                  + ' er med i gratis-niveauet; er den optaget, sendes kaldet videre til'
                  + ' den næste model, og linjen nedenfor siger hvem der svarede.'
                : 'Gemini tegner først et fotografi og måler det bagefter. Billedmodellerne'
                  + ' har ingen gratis-kvote — de kræver fakturering på Google-projektet.'}
            </p>

            {/*
              * What the last run did. Measured: the model that
              * answered, its own token count and the wall clock.
              *
              * And, on its own line under them, what it cost. That one
              * is an ESTIMATE and says so — list price by the token,
              * converted at a fixed rate (see `price.ts`) — because
              * the only figure that is actually true is the bill. It
              * is worth having anyway: a tile that quietly costs forty
              * times the one before it should be visible while
              * somebody is still iterating on it.
              */}
            {clusterRun && (
              <div className="way__run">
                <p>
                  {(clusterRun.elapsedMs / 1000).toFixed(1)}s
                  {clusterRun.model ? ` · ${clusterRun.model}` : ''}
                  {/* Not a footnote: this is the line that says the
                      tile in front of you was not made by the model
                      you chose. */}
                  {clusterRun.insteadOf
                    ? <b className="way__swap"> ⚠ ikke {clusterRun.insteadOf} — den var optaget</b>
                    : ''}
                  {clusterRun.drawnBy ? ` · tegnet af ${clusterRun.drawnBy}` : ''}
                  {clusterRun.tokens ? ` · ${(clusterRun.tokens / 1000).toFixed(1)}k tokens` : ''}
                  {clusterRun.view === 'top' ? ' · fladt, set oppefra' : ''}
                  {clusterRun.view === 'side' ? ' · stående på én linje' : ''}
                </p>
                {clusterRun.tokens !== null && (() => {
                  const dkk = priceOf(
                    clusterRun.model, clusterRun.inputTokens, clusterRun.outputTokens,
                  );
                  return (
                    <p className="way__price">
                      {dkk === null
                        // Never a guessed number: a price in kroner
                        // that was invented looks like one that was
                        // measured.
                        ? `ingen pris for ${clusterRun.model} — tilføj den i price.ts`
                        : (
                          <>
                            {saidPrice(dkk)} <i>anslået</i>
                            {' · '}
                            {(clusterRun.inputTokens / 1000).toFixed(1)}k ind
                            {' / '}
                            {(clusterRun.outputTokens / 1000).toFixed(1)}k ud
                          </>
                        )}
                    </p>
                  );
                })()}
                <p>
                  Stillede {clusterRun.placed} af {clusterRun.of} varer op.
                  {clusterRun.order.length > 0
                    && ` Bagest først: ${clusterRun.order.join(' · ')}.`}
                </p>
                {clusterRun.complaints.map((said) => (
                  <p className="way__warn" key={said}>⚠ {said}</p>
                ))}
              </div>
            )}

            {/*
              * The prompt, where the person looking at the tile is.
              *
              * This is the fastest loop anybody has found for making a
              * tile better — change a line, press the button, look —
              * and it was only possible in the repository until now.
              * Empty means the standing prompt; what is typed here
              * replaces it for this browser until it is cleared.
              */}
            {/*
              * Which of the standing prompts this tile is made with.
              *
              * Two ways of saying the same craft — numbered rules, or
              * the same thing told in sentences — and a model does not
              * read the two the same way. Kept as a switch rather than
              * a decision taken once in the repository: the only place
              * the question can be answered is on a tile, and picking
              * one must never be what loses the other.
              */}
            <div className="way__prompt">
              <span className="way__which">Prompt</span>
              <div className="segment">
                {PLACE_PROMPTS.map((entry) => (
                  <button
                    key={entry.id}
                    className={clusterPromptId === entry.id ? 'is-on' : ''}
                    title={entry.said}
                    onClick={() => setClusterPromptId(entry.id)}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
              {clusterPrompt && <span className="way__badge">din egen bruges</span>}
            </div>

            <div className="way__prompt">
              <button className="inspector__link" onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? 'Skjul prompten' : 'Vis prompten'}
              </button>
            </div>

            {showPrompt && (
              <>
                {/* The chosen one, until somebody types over it — and
                    then what they typed, for every run, whichever
                    button is lit. */}
                <textarea
                  className="way__text"
                  value={clusterPrompt || placePrompt(clusterPromptId)}
                  spellCheck={false}
                  onChange={(event) => setClusterPrompt(event.target.value)}
                />
                <div className="way__prompt">
                  <button
                    className="inspector__link"
                    disabled={!clusterPrompt}
                    onClick={() => setClusterPrompt('')}
                  >Tilbage til “{PLACE_PROMPTS.find((e) => e.id === clusterPromptId)?.name}”</button>
                </div>

                {/*
                  * The last few runs.
                  *
                  * A prompt is improved by changing a line and
                  * looking — which needs the line before it to still
                  * be somewhere. Each row says what it produced, and
                  * Hent puts those words back in the box so the two
                  * can be run against the same tile.
                  */}
                {promptRuns.length > 0 && (
                  <ol className="way__runs">
                    {promptRuns.map((run) => (
                      <li key={run.at}>
                        <span>
                          {new Date(run.at).toLocaleTimeString('da-DK', {
                            hour: '2-digit', minute: '2-digit',
                          })}
                          {' · '}{run.placed}/{run.of} varer
                          {' · '}{(run.elapsedMs / 1000).toFixed(0)}s
                          {' · '}{run.model || 'standard'}
                          {/* What it was made with: a hand-written
                              prompt, or one of the shipped ones by
                              name. A run from before there were two
                              can only say "standard". */}
                          {' · '}
                          {run.prompt
                            ? 'din prompt'
                            : PLACE_PROMPTS.find((e) => e.id === run.promptId)?.name
                              ?? 'standard'}
                        </span>
                        <button
                          className="inspector__link"
                          disabled={run.prompt === clusterPrompt}
                          onClick={() => setClusterPrompt(run.prompt)}
                          title={run.prompt
                            ? 'Læg denne prompt tilbage i feltet'
                            : 'Tilbage til standardprompten'}
                        >Hent</button>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
            </details>
          </div>

          {/*
            * The proof, when there is one.
            *
            * Only the round trip makes a picture, and this is what it
            * is FOR: laid over the tile, a product that landed where
            * the composition put it lies inside its own photograph,
            * and one that did not stands beside it. Nothing else in
            * this panel can tell the two apart.
            */}
          {(() => {
            const ghost = ghosts.find((entry) => entry.offerId === offer.id);
            return ghost && (
            <div className="proof">
              <button
                className="inspector__link"
                title="Læg AI'ens forslag over varerne, så du kan se om de står som på det"
                onClick={() => toggleGhost(offer.id)}
              >
                {ghost.shown ? 'Skjul forslaget' : 'Vis forslaget oven på varerne'}
              </button>
              {/* What the arithmetic did, for the tile that comes out
                  wrong — see `reference.report`. */}
              <details className="way__more">
                <summary>Tallene bag</summary>
                <textarea
                  className="proof__numbers"
                  readOnly
                  value={ghost.report.join('\n')}
                />
                <button
                  className="inspector__link"
                  onClick={() => {
                    void navigator.clipboard?.writeText(ghost.report.join('\n'));
                  }}
                >Kopiér tallene</button>
              </details>
            </div>
            );
          })()}

          {/*
            * A picture from outside, and the two things it can be.
            *
            * What used to stand here was the way round a key that
            * could not draw: the prompt and the numbered cutouts, to
            * be run in Gemini's own app by hand. The key draws now,
            * and the studio does the whole job in one press, so that
            * detour is gone. What is left is the case it never
            * covered — a designer with a photograph of their own.
            */}
          <h3 className="inspector__group">Dit eget billede</h3>

          <label className="drop drop--layout">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) await applyClusterLayout(offer.id, file);
              }}
            />
            <span>
              Brug billedet som opstilling
              <em>dine egne udklip flytter sig — intet gentegnet</em>
            </span>
          </label>

          <label className="drop">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) await setTileImage(offer.id, file);
              }}
            />
            <span>
              Læg billedet på flisen som det er
              <em>billedets egne pixels, etiketter og alt</em>
            </span>
          </label>
        </>
      )}
    </>
  );
}
