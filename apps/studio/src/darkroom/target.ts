import { packOverride, tidyAdjust, type ImageAdjust } from '@incitio/schema';
import { useStudioPick } from '../state.js';

/** The one photograph being developed: a tile's artwork, one product of a cluster, or a picture on the page. */
export type AdjustTarget =
  | { kind: 'tile'; offerId: string }
  | { kind: 'pack'; offerId: string; index: number }
  | { kind: 'decor'; pageId: string; decorId: string };

export interface Developing {
  /** What is set now — `{}` when nothing. */
  adjust: ImageAdjust;
  /** The photograph itself, as the feed or the upload linked it. */
  imageUrl: string | null;
  /** A cluster's wrapper is not one photograph: no crop, no mask. */
  whole: boolean;
  /** Merge a patch over what is set; `gesture` coalesces a drag into one undo step. */
  write: (patch: Partial<ImageAdjust>, gesture?: string) => void;
  /** Everything back. */
  reset: () => void;
  endGesture: () => void;
  /** A stable key for gesture names. */
  key: string;
}

export function targetKey(target: AdjustTarget): string {
  return target.kind === 'decor' ? `decor:${target.decorId}` : target.kind === 'pack' ? `pack:${target.offerId}:${target.index}` : `tile:${target.offerId}`;
}

/** Read and write one photograph's development through the studio's own edits, so undo, saving and the page all follow. */
export function useDeveloping(target: AdjustTarget | null): Developing | null {
  const { document, updateOverrides, updatePackItem, updatePageImage, endGesture } = useStudioPick('document', 'updateOverrides', 'updatePackItem', 'updatePageImage', 'endGesture');
  if (!document || !target) return null;
  const key = targetKey(target);

  if (target.kind === 'decor') {
    const page = document.pages.find((p) => p.id === target.pageId);
    const decor = page?.decorations.find((d) => d.id === target.decorId);
    if (!decor) return null;
    const adjust = decor.adjust ?? {};
    return {
      adjust, imageUrl: decor.imageUrl, whole: false, key, endGesture,
      write: (patch, gesture) => updatePageImage(target.pageId, target.decorId, { adjust: tidyAdjust({ ...adjust, ...patch }) }, gesture ?? `adjust:${key}`),
      reset: () => updatePageImage(target.pageId, target.decorId, { adjust: undefined }),
    };
  }

  const offer = document.offers.find((o) => o.id === target.offerId);
  const placement = document.pages.flatMap((p) => p.placements).find((p) => p.offerId === target.offerId);
  if (!offer || !placement) return null;
  const { overrides } = placement;

  if (target.kind === 'pack') {
    const adjust = packOverride(overrides, target.index).adjust ?? {};
    return {
      adjust, imageUrl: offer.imagePack[target.index] ?? null, whole: false, key, endGesture,
      write: (patch, gesture) => updatePackItem(target.offerId, target.index, { adjust: tidyAdjust({ ...adjust, ...patch }) }, gesture ?? `adjust:${key}`),
      reset: () => updatePackItem(target.offerId, target.index, { adjust: undefined }),
    };
  }

  const adjust = overrides.adjust ?? {};
  const packed = offer.imagePack.length > 1;
  return {
    adjust,
    imageUrl: offer.imageUrl ?? offer.imagePack[0] ?? null,
    whole: packed,
    key, endGesture,
    write: (patch, gesture) => updateOverrides(target.offerId, { adjust: tidyAdjust({ ...adjust, ...patch }) }, gesture ?? `adjust:${key}`),
    reset: () => updateOverrides(target.offerId, { adjust: undefined }),
  };
}
