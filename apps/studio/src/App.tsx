import { useEffect, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { PageView } from '@incitio/renderer';
import { RETAILERS } from '@incitio/pipeline';
import { useStudio } from './state.js';
import { EditableSlot } from './EditableSlot.js';
import { Inspector } from './Inspector.js';

export function App() {
  const {
    offers, library, document, selectedOfferId, lastError, past, future,
    librarySource, minedLibrary, retailer,
    planning, plannerReady, planReasoning, houseLibrary, uploadNote,
    loadSampleFeed, regenerate, select, swapPlacements, reshufflePage, movePage, undo, redo,
    setLibrarySource, setRetailer, generateWithAi, uploadFeed,
  } = useStudio();

  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function takeFile(file: File | undefined) {
    if (!file) return;
    uploadFeed(file.name, await file.text());
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    void loadSampleFeed();
  }, [loadSampleFeed]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Undo/redo on the platform shortcut; the editor is keyboard-first by habit.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const [fromPage, fromSlot] = String(active.id).split('::');
    const [toPage, toSlot] = String(over.id).split('::');
    if (!fromPage || !fromSlot || !toPage || !toSlot) return;

    const result = swapPlacements({ pageId: fromPage, slotId: fromSlot }, { pageId: toPage, slotId: toSlot });
    if (!result.ok) {
      setToast(
        result.violations[0]?.message ?? 'Byttet blev afvist af en regel for opsætningen.',
      );
    }
  }

  const templates = new Map(library.templates.map((t) => [t.id, t]));

  return (
    <div
      className={`app${dragging ? ' app--dropping' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void takeFile(e.dataTransfer.files[0]);
      }}
    >
      <header className="toolbar">
        <strong className="toolbar__brand">Incitio</strong>
        <span className="toolbar__doc">{document?.name ?? 'Indlæser…'}</span>
        <label className="upload" title="Upload et feed (CSV eller JSON)">
          <input
            type="file"
            accept=".csv,.json,.txt"
            onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          <span>Upload feed</span>
        </label>
        <div className="toolbar__spacer" />
        <label className="toolbar__toggle" title="Datakilde">
          <span>Kæde</span>
          <select value={retailer.id} onChange={(e) => void setRetailer(e.target.value)}>
            {Object.values(RETAILERS).map((r) => (
              <option key={r.id} value={r.id}>{r.displayName}</option>
            ))}
          </select>
        </label>
        <label className="toolbar__toggle" title="Skabeloner udvundet af rigtige kataloger">
          <span>Skabeloner</span>
          <select
            value={librarySource}
            onChange={(e) => setLibrarySource(e.target.value as 'house' | 'mined' | 'authored')}
          >
            {houseLibrary && (
              <option value="house">
                Kædens egne ({houseLibrary.templates.length})
              </option>
            )}
            <option value="mined" disabled={!minedLibrary}>
              Alle kæder{minedLibrary ? ` (${minedLibrary.templates.length})` : ' — mangler'}
            </option>
            <option value="authored">Håndlavet (6)</option>
          </select>
        </label>
        <button onClick={undo} disabled={past.length === 0}>Fortryd</button>
        <button onClick={redo} disabled={future.length === 0}>Gentag</button>
        <button onClick={regenerate} disabled={planning}>Generér forfra</button>
        <button
          className="primary"
          onClick={() => void generateWithAi()}
          disabled={planning || !plannerReady}
          title={plannerReady
            ? 'Lad Claude bestemme sidernes indhold'
            : 'Tilføj ANTHROPIC_API_KEY i .env og genstart API-serveren'}
        >
          {planning ? <><span className="spinner" aria-hidden="true" /> Planlægger…</> : 'Generér med AI'}
        </button>
      </header>

      {lastError && <div className="banner banner--error">{lastError}</div>}
      {uploadNote && !lastError && (
        <div className="banner banner--ok">{uploadNote}</div>
      )}
      {!plannerReady && (
        <div className="banner banner--hint">
          AI-planlægning er slået fra. Læg din nøgle i <code>.env</code> som{' '}
          <code>ANTHROPIC_API_KEY=sk-ant-…</code> og genstart API-serveren med{' '}
          <code>npm run dev:api</code>.
        </div>
      )}

      <div className="app__body">
        <main className="canvas">
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            {document?.pages.map((page, index) => {
              const template = templates.get(page.templateId);
              if (!template) return null;
              const promotable = new Set(
                template.slots.filter((s) => s.promotesTo.length > 0).map((s) => s.id),
              );

              return (
                <div className="page-wrap" key={page.id}>
                  <div className="page-wrap__bar">
                    <span className="page-wrap__label">
                      Side {index + 1} · {template.name}
                      {planReasoning[index] && (
                        <em className="page-wrap__why"> · {planReasoning[index]}</em>
                      )}
                    </span>
                    <button onClick={() => movePage(page.id, -1)} disabled={index === 0}>↑</button>
                    <button
                      onClick={() => movePage(page.id, 1)}
                      disabled={index === document.pages.length - 1}
                    >↓</button>
                    <button onClick={() => reshufflePage(page.id)}>Nyt layout</button>
                  </div>
                  <PageView
                    page={page}
                    template={template}
                    offers={offers}
                    theme={document.theme}
                    pageAspect={document.pageAspect}
                    pageNumber={index + 1}
                    selectedOfferId={selectedOfferId}
                    onSelectOffer={select}
                    slotDecorator={(slotId) => (
                      <EditableSlot pageId={page.id} slotId={slotId} canPromote={promotable.has(slotId)} />
                    )}
                  />
                </div>
              );
            })}
          </DndContext>
        </main>
        <Inspector />
      </div>

      {dragging && <div className="dropzone">Slip filen for at bygge et katalog</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
