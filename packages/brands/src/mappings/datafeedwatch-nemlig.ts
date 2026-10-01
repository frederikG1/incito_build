import type { OfferLabelInput } from '@incitio/schema';
import { parsePrice, resolveLabels, type FieldMapping, type LabelAliases, type LabelDictionary } from '@incitio/ingest';

/** A DataFeedWatch product feed as nemlig.com exports it (XML, or its JSON conversion). */
export const DATAFEEDWATCH_NEMLIG_SIGNATURE = { fields: ['ProductSku', 'CampaignPriceDK01'] };

/**
 * nemlig.com via DataFeedWatch — flat records, one per product, campaign
 * fields suffixed with the price zone (`DK01`).
 *
 * Sample: `data/feeds/nemlig.json`, converted from
 * feeds.datafeedwatch.com/74998/…xml; the XML reads the same. Check a
 * change with `npm run map -- data/feeds/nemlig.json --check`.
 */
export function datafeedwatchNemlig(retailerId = 'nemlig', sourceName = 'nemlig.json'): FieldMapping {
  return {
    retailerId,
    sourceName,
    currency: 'DKK',
    unread: {
      ProductName: 'fallback for name when NewOfferTitle_Single is empty',
      DestinationImageUrlDepend: 'fallback for imageUrl: a padded JPEG on white',
      DestinationUrl: 'product page on nemlig.com',
      Description: 'keyword soup for search, not display copy',
      PricePerUnit: 'the unit price as text; comparison is computed from quantity instead',
      CampaignIsMixFlagDK01: 'MinQuantity and CampaignPriceDependDK01 already say it',
      MixOfferFlag: 'same as CampaignIsMixFlagDK01',
      CampaignFlag: 'true on every row of a campaign feed',
      OfferGroupIDDK01: 'campaign id',
      NewOfferTitle_Group: 'a group headline for several offers; one offer has its own',
    },
    sparse: {
      description: 'ProductPaidMediaDescription is the only candidate and it is the quantity line',
    },
    fields: {
      id: 'ProductSku',
      // The feed writes a ready-made offer headline; prefer it over the
      // bare product name, which omits the brand. It is built as
      // "<product> fra <brand>", so a row with no brand arrives with a
      // dangling "fra" that has to be trimmed.
      name: (row) => {
        const headline = String(row['NewOfferTitle_Single'] ?? '').trim();
        const cleaned = headline.replace(/\s+fra\s*$/i, '').trim();
        return cleaned || String(row['ProductName'] ?? '').trim() || null;
      },
      brand: 'ProductBrandName',
      category: ['NewMainCategory', 'MainCategory'],
      // No description: ProductPaidMediaDescription is the quantity line
      // ("8 stk. / 13,5cl") and using it for both renders it twice. The
      // feed's `Description` is a keyword soup, not display copy.
      description: () => null,
      // CampaignPrice is what the customer pays; Price is the before.
      price: ['CampaignPriceDK01', 'Price'],
      prePrice: (row) => {
        const before = Number(String(row['Price'] ?? '').replace(',', '.'));
        const now = Number(String(row['CampaignPriceDK01'] ?? '').replace(',', '.'));
        return Number.isFinite(before) && Number.isFinite(now) && before > now ? before : null;
      },
      savings: 'CampaignCustomerSavingsDK01',
      // "25%"; a few rows say "0%" or "-30%", which is no saving.
      savingsPercent: (row) => {
        const percent = parsePrice(row['CampaignCustomerSavingsPercentDK01']);
        return percent !== null && percent > 0 ? percent : null;
      },
      quantity: 'ProductPaidMediaDescription',
      validFrom: 'CampaignStart',
      validTo: 'CampaignEnd',
      // RawImage is the transparent cutout; the Destination URL is a
      // padded JPEG on white and only a fallback.
      imageUrl: ['RawImage', 'DestinationImageUrlDepend'],
      priority: (row: Record<string, unknown>) =>
        CAMPAIGN_WEIGHT[String(row['CampaignTypeDK01'] ?? '')] ?? null,
      labels: nemligLabels,
    },
  };
}

/**
 * nemlig grades every offer by campaign tier. That is editorial weight
 * stated by the chain, so it is used directly rather than deriving
 * prominence from discount depth.
 */
const CAMPAIGN_WEIGHT: Record<string, number> = {
  'Prioriterede tilbud': 0.9,
  'Priskup': 0.75,
  'Skarp Pris': 0.6,
  'Kategoritilbud (kampagne)': 0.45,
  'Restsalg': 0.3,
};

/**
 * nemlig's own wording for marks the dictionary already holds. Its feed
 * writes the full Danish name ("Nøglehulsmærket") where the dictionary
 * is filed under the short form, and splits organic into origin variants
 * that share one mark.
 */
const NEMLIG_LABEL_ALIASES: LabelAliases = {
  'Øko (dansk)': 'organic',
  'Øko (europæisk)': 'organic',
  'Økologisk': 'organic',
  'Nøglehulsmærket': 'noglehul',
  'Fuldkornsmærket': 'fuldkorn',
  'Fairtrade-mærket': 'fairtrade',
  'MSC-mærket': 'msc',
  'ASC-mærket': 'asc',
  'Astma-Allergi Danmark': 'astmaforeningen',
  'Vegansk': 'vegan eu',
  'Dybfrost': 'dybfrost',
};

function nemligLabels(
  row: Record<string, unknown>,
  dictionary: LabelDictionary,
): OfferLabelInput[] {
  const labels: OfferLabelInput[] = [];
  const text = (key: string) => String(row[key] ?? '').trim();

  const minQuantity = Number(text('MinQuantity'));
  if (Number.isFinite(minQuantity) && minQuantity > 1) {
    // The "Depend" field holds a complete Danish offer phrase — "Mix 3
    // stk 89.00", "Ta' 2 for 40.00" — not a bare number, so it is used
    // verbatim. Prefixing it produces "2 for Ta' 2 for 40.00".
    const phrase = text('CampaignPriceDependDK01');
    const plainPrice = text('CampaignPriceDK01');
    if (phrase) {
      labels.push({ kind: 'multibuy', text: phrase });
    } else if (plainPrice) {
      labels.push({ kind: 'multibuy', text: `${minQuantity} for ${plainPrice}` });
    }
  }
  if (text('BuyXforYFlag') === 'True') {
    labels.push({ kind: 'multibuy', text: 'Køb X få Y' });
  }

  const splat = text('SaleSplatPriceTextDK01');
  const percent = text('CampaignSaleSplatPriceSavingsDK01');
  if (splat && percent) labels.push({ kind: 'saving', text: `${splat} ${percent}` });

  // Markings is a certification list. Resolving it turns "Øko (dansk)"
  // from a text tag into the Ø-mark itself, and collapses the several
  // spellings of one certification into a single badge.
  labels.push(
    ...resolveLabels(dictionary, text('Markings').split(/[,;|]/), NEMLIG_LABEL_ALIASES),
  );
  if (text('Fritvalg_Flerevarianter')) {
    labels.push({ kind: 'custom', text: text('Fritvalg_Flerevarianter') });
  }
  return labels;
}
