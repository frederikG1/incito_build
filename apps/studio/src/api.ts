/**
 * The studio's client for the API, one file per part of it in `api/`.
 * Everything is re-exported here, so `import * as api from './api.js'`
 * reads as it always did.
 */
export { BRAND_HEADER, KEY_HEADER, hasImageKey, imageKeyTail, setImageKey, SIGNED_OUT_EVENT } from './api/http.js';
export type { SignedInUser } from './api/http.js';
export { fetchMe, signIn, signOut } from './api/auth.js';
export { fetchBrands, checkFeed, fetchBrandProfile, fetchCurationStatus, fetchDecorStatus, fetchThemes, saveThemes, fetchSections, saveOfferRules, saveOfferDesigns, saveSection, removeSection } from './api/chain.js';
export type { BrandSummary, BrandSource, BrandProfile, DecorStatus, Section } from './api/chain.js';
export { decorateDocument, buildCatalogue, fetchUploads, forgetUpload, uploadImage, readFeed } from './api/build.js';
export type { DecorResult, DecorDirection, BuildReply, BuildRequest, LibraryImage, UploadedImage, FeedReading } from './api/build.js';
export { patchCatalogue, fetchCatalogues, fetchCover, SaveConflict, SaveRefused, saveCatalogue, approveCatalogue, unapproveCatalogue, bookPlace, releasePlace, publishCatalogue, unpublishCatalogue, sendLiveChange, fetchVersions, fetchVersion, fetchCatalogue, fetchCataloguePdf, instructEdit } from './api/catalogs.js';
export type { CatalogStatus, CatalogSummary, CatalogCover, Workflow, CatalogueVersion, InstructReply } from './api/catalogs.js';
export { fetchFeed, reproducePage, importPublication, generateLayout } from './api/references.js';
export type { ReproduceRequest, ReproduceReply, PageReading, PublicationReply, LayoutRequest, LayoutReply } from './api/references.js';
export { drawBackdrop, splitVariants, arrangeGroup, composeCluster, prepareCluster, placeCluster, readClusterLayout } from './api/clusters.js';
export type { DrawnMotif, ArrangeReply, ClusterReply, PrepareReply, LayoutReading } from './api/clusters.js';
