import type { CatalogDocument, Offer, TemplateLibrary } from '@incitio/schema';
import { PageView } from './PageView.js';

export interface CatalogViewProps {
  document: CatalogDocument;
  offers: Map<string, Offer>;
  library: TemplateLibrary;
  selectedOfferId?: string | null;
  onSelectOffer?: (offerId: string) => void;
}

export function CatalogView({
  document,
  offers,
  library,
  selectedOfferId,
  onSelectOffer,
}: CatalogViewProps) {
  const templates = new Map(library.templates.map((t) => [t.id, t]));

  return (
    <div className="catalog">
      {document.pages.map((page, index) => {
        const template = templates.get(page.templateId);
        if (!template) {
          return (
            <div className="page page--error" key={page.id}>
              Ukendt skabelon: {page.templateId}
            </div>
          );
        }
        return (
          <PageView
            key={page.id}
            page={page}
            template={template}
            offers={offers}
            theme={document.theme}
            pageAspect={document.pageAspect}
            pageNumber={index + 1}
            selectedOfferId={selectedOfferId ?? null}
            {...(onSelectOffer ? { onSelectOffer } : {})}
          />
        );
      })}
    </div>
  );
}
