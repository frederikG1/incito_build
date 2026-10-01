import type { OfferLabelInput } from '@incitio/schema';
import { resolveLabels, type FieldMapping, type LabelDictionary } from '@incitio/ingest';

/**
 * Republica's motive service, where SuperBrugsen's artwork lives.
 *
 * Taken from the chain's own offers transformer. `trim=1` is what makes
 * these usable on a coloured page field: the service returns the
 * packshot cropped to the product, so it drops onto the cream ground
 * without a white box around it.
 *
 * The key is necessarily visible to the browser — it fetches the images
 * — so this is not a secret leaking by living here.
 */
const REPUBLICA_KEY = 'k8kf7626waqu4p3scbegcqghay74a6q8';

function republicaImage(motivId: string): string {
  return `https://imageservice2.republica.dk/motive/${motivId}`
    + `?size=800&format=png&trim=1&key=${REPUBLICA_KEY}`;
}

/** How to recognise the file: records two levels down, under `Pages[].Entries[]`. */
export const COOP_EXPORT_SIGNATURE = { fields: ['Header', 'Motivid', 'Priority'], nested: true };

/**
 * Coop's own tilbudsavis export — SuperBrugsen, Kvickly, Coop 365 and
 * Brugsen share it. Nested `Pages[].Entries[]`, one entry per printed
 * offer, artwork by Republica motive id.
 *
 * Sample: `data/feeds/SuperBrugsenW36.json`. Check a change with
 * `npm run map -- data/feeds/SuperBrugsenW36.json --check`.
 */
export function coopExport(retailerId: string, sourceName = 'tilbudsavis.json'): FieldMapping {
  return {
    retailerId,
    sourceName,
    currency: 'DKK',
    unread: {
      DeepLink: 'link to the web avis; nothing in print uses it',
      InfoTextVarebeskrivelse: 'a fragment of InfoText, which is read whole — see description',
      InfoTextFlerevarianter: 'a fragment of InfoText',
      InfoTextVarebeskrivendemaengde: 'a fragment of InfoText; the weight prints inside the fine print',
      InfoTextPrissammenligning: 'a fragment of InfoText; the chain states its own unit price there',
      InfoTextFritvalg: 'a fragment of InfoText',
      ShortManusType: 'abbreviation of ManusType, which is read',
      Comment: 'print notes to the designer ("Bjælke: 3-pak", wine medals), not offer copy',
      Tracking: 'analytics ids',
      Tagging: 'search words',
      _pageNumber: 'added by extractRows for the check; Offer has no page field',
      _pageName: 'added by extractRows for the check; Offer has no page field',
    },
    sparse: {
      quantity: 'the weight is printed inside InfoText with the chain\'s own "Kg-pris maks."; a parsed size would print it twice',
    },
    // Offers live in Pages[].Entries[]; the page number rides along
    // because it is the chain's own editorial grouping.
    extractRows: (payload) => {
      const pages = (payload as { Pages?: unknown[] })?.Pages;
      if (!Array.isArray(pages)) return [];
      return pages.flatMap((page) => {
        const p = page as { PageNumber?: number; PageName?: string; Entries?: unknown[] };
        return (p.Entries ?? []).map((entry) => ({
          ...(entry as Record<string, unknown>),
          _pageNumber: p.PageNumber,
          _pageName: p.PageName,
        }));
      });
    },
    fields: {
      id: (row) => String(row['Id'] ?? '') || null,
      name: 'Header',
      brand: (row) => {
        const varer = row['Varer'];
        if (!Array.isArray(varer) || varer.length === 0) return null;
        return (varer[0] as { BrandName?: string }).BrandName ?? null;
      },
      category: (row) => {
        const varer = row['Varer'];
        if (!Array.isArray(varer) || varer.length === 0) return null;
        return (varer[0] as { CategoryName?: string }).CategoryName ?? null;
      },
      /*
       * The fine print, and the chain writes it itself.
       *
       * `InfoText` is the whole printed line — "Dybfrost. Flere
       * varianter. 300-370 g. Kg-pris maks. 63,33. Frit valg." — and
       * it is present on all 160 week-36 entries. This used to read
       * `InfoTextVarebeskrivelse`, which is only its FIRST fragment
       * ("Dybfrost."), so the page dropped the legally required
       * comparison price and every qualifier with it.
       *
       * The component fields are still there, and on 138 of the 160 an
       * `InfoText` reconstructed from them matches exactly; on the
       * other 22 it differs only in punctuation, and always in
       * `InfoText`'s favour ("kl. I." rather than "kl. I"). So the
       * assembled field is the one to trust rather than something to
       * rebuild.
       *
       * `Quantity` — "1 pose.", "1 flaske." — is appended because that
       * is where the printed page puts it: at the end of the same
       * sentence, not on a line of its own. It is modelled separately
       * as a piece count for the unit-price maths, which states no
       * words and so prints none.
       */
      description: (row) => {
        const line = String(row['InfoText'] ?? '').trim();
        const unit = String(row['Quantity'] ?? '').trim();
        if (!unit) return line || null;
        // The feed is inconsistent about the closing full stop.
        const closed = /[.!?]$/.test(unit) ? unit : `${unit}.`;
        return [line, closed].filter(Boolean).join(' ');
      },
      price: 'Price',
      prePrice: 'NormalPrice',
      savings: 'Save',
      memberPrice: (row) => (Number(row['MemberPrice']) > 0 ? Number(row['MemberPrice']) : null),
      savingsPercent: (row) => (Number(row['SavePercentage']) > 0 ? Number(row['SavePercentage']) : null),
      // "Pack" on a packshot, "Miljø" on a photograph of the product in use.
      imageKind: (row) => {
        const kind = String(row['MotivType'] ?? '').trim().toLowerCase();
        return kind === 'pack' ? 'pack' : kind === 'miljø' || kind === 'miljo' ? 'lifestyle' : null;
      },
      campaign: (row) => String(row['OfferType'] ?? '').trim() || null,
      /*
       * "Spar 29,95 - 49,95" — the saving on an offer whose products had
       * different normal prices.
       *
       * Four of the 160 week-36 entries carry one, all of them wine, all
       * of them two or three bottles at one price that were not one
       * price before. `savings` takes the first number, which is what a
       * loose `parsePrice` already did; without this the page printed
       * "Spar 29,95" over a bottle whose saving was 49,95 and over
       * another whose saving really was 29,95 — one figure, true of one
       * product, printed over both.
       */
      savingsMax: (row) => {
        const range = /(\d[\d.,]*)\s*[-–]\s*(\d[\d.,]*)/.exec(String(row['Save'] ?? ''));
        if (!range) return null;
        const high = Number(range[2]!.replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(high) ? high : null;
      },
      quantity: 'Quantity',
      /*
       * `Quantity` holds the PACK here — "1 stk.", "1 pakke", "1 flaske"
       * on 21 of the 160 week-36 entries — not a weight. The weight is
       * in `InfoTextVarebeskrivendemaengde` ("300-370 g") and reaches
       * the tile through the description. So the same field feeds both,
       * and that is not a duplication: `parseQuantity` reads "1 pakke"
       * as one piece of nothing and `formatQuantity` prints nothing for
       * it, which is why the fine print does not repeat the mark.
       */
      pack: 'Quantity',
      validFrom: 'ValidDateFrom',
      validTo: 'ValidDateTo',
      /*
       * Artwork, via the motive id. The entry carries its own `Motivid`
       * and it matches `Varer[0].MotivId` on all 160 week-36 entries, so
       * the entry-level value is used and the first product is only a
       * fallback for a feed where it is missing.
       */
      imageUrl: (row) => {
        const own = String(row['Motivid'] ?? '').trim();
        if (own) return republicaImage(own);
        const varer = row['Varer'];
        if (!Array.isArray(varer) || varer.length === 0) return null;
        const first = String((varer[0] as { MotivId?: unknown }).MotivId ?? '').trim();
        return first ? republicaImage(first) : null;
      },
      /*
       * Every variant of the offer, for a "Frit valg" tile. 115 of the
       * 160 week-36 entries carry two or more distinct motives and 111 of
       * those are flagged "Frit valg" or "Flere varianter" — one price
       * covering several products. Rendering just the first would print a
       * tile that names three variants and shows one.
       */
      imagePack: (row) => {
        const varer = Array.isArray(row['Varer']) ? row['Varer'] : [];
        const ids = [
          String(row['Motivid'] ?? '').trim(),
          ...varer.map((v) => String((v as { MotivId?: unknown }).MotivId ?? '').trim()),
        ].filter(Boolean);
        return ids.map(republicaImage);
      },
      // Priority is inverse prominence: 2 is the big tile, 4 the small one.
      priority: (row) => {
        const value = Number(row['Priority']);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, (5 - value) / 3)) : null;
      },
      labels: (row: Record<string, unknown>, dictionary: LabelDictionary) => {
        const labels: OfferLabelInput[] = [];

        // `Logos` lists mark names — "Økologi", "Flag", "Bedre dyrevelfærd
        // 3" — and the shipped dictionary keys artwork off exactly those
        // strings. Resolving here turns the name into the mark itself and
        // collapses the several spellings of one certification.
        const logos = row['Logos'];
        if (Array.isArray(logos)) {
          labels.push(...resolveLabels(dictionary, logos.map((l) => String(l ?? ''))));
        }

        /*
         * "Frit valg." and "Flere varianter." are NOT chips.
         *
         * They used to be pushed here as custom labels, and the page
         * printed a dark rounded badge saying "Frit valg." on almost
         * every tile — which reads as a promotional mechanic the chain
         * is pushing, like a multibuy. It is neither. Both strings are
         * fine print, both are already inside `InfoText`, and the
         * printed book sets them in the small line under the headline
         * along with the kilo price. Chipping them said something
         * false and said it twice.
         */
        if (Number(row['MemberPrice']) > 0) {
          labels.push({ kind: 'member', text: `Medlemspris ${row['MemberPrice']}` });
        }
        // The mechanic, in the chain's words: `ManusType` "3 for 2". "Mix" is the ordinary offer.
        const mechanic = String(row['ManusType'] ?? '').trim();
        if (mechanic && !/^mix$/i.test(mechanic)) labels.push({ kind: 'multibuy', text: mechanic });
        return labels;
      },
    },
  };
}
