import type { FamilyGraph } from '@family-tree/shared';
import { type BranchScope, narrowGraph, partialYear } from '@family-tree/shared';
import { cn } from '@family-tree/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Box, GitFork, Layers, Network, User, Waypoints, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { PersonSearch } from '#/components/shared/PersonSearch.tsx';
import { YearSlider } from '#/components/shared/YearSlider.tsx';
import { useFamilyGraph } from '#/entities/family/queries.ts';
import { PersonQuickPanel } from '#/features/people/PersonQuickPanel.tsx';
import { personShortName } from '#/lib/display.ts';
import { usePrefs } from '#/lib/prefs.ts';

// Heavy views (React Flow, force-graph, Mind Elixir, three.js) load on demand.
const FamilyTree2D = lazy(() => import('#/features/tree-2d/index.tsx').then((m) => ({ default: m.FamilyTree2D })));
const PersonCentredView = lazy(() =>
  import('#/features/tree-2d/index.tsx').then((m) => ({ default: m.PersonCentredView })),
);
const GenerationView = lazy(() => import('#/features/tree-2d/index.tsx').then((m) => ({ default: m.GenerationView })));
const FamilyGraphView = lazy(() =>
  import('#/features/graph-view/index.tsx').then((m) => ({ default: m.FamilyGraphView })),
);
const FamilyMindMap = lazy(() => import('#/features/mind-map/index.tsx').then((m) => ({ default: m.FamilyMindMap })));
const Studio3D = lazy(() => import('#/features/studio-3d/index.tsx').then((m) => ({ default: m.Studio3D })));

const VIEWS = ['tree', 'person', 'generation', 'graph', 'mindmap', 'studio'] as const;
type View = (typeof VIEWS)[number];

const ICONS: Record<View, typeof Network> = {
  tree: GitFork,
  person: User,
  generation: Layers,
  graph: Waypoints,
  mindmap: Network,
  studio: Box,
};

const COMPONENTS = {
  tree: FamilyTree2D,
  person: PersonCentredView,
  generation: GenerationView,
  graph: FamilyGraphView,
  mindmap: FamilyMindMap,
  studio: Studio3D,
} satisfies Record<View, unknown>;

export const Route = createFileRoute('/_app/f/$familyId/tree')({
  validateSearch: z.object({
    view: z.enum(VIEWS).catch('tree'),
    person: z.string().optional(),
    year: z.number().int().optional().catch(undefined),
    /** Narrows every view to this person's branch (see `BranchScope`). */
    root: z.string().optional(),
    scope: z.enum(['down', 'line']).optional().catch(undefined),
  }),
  component: TreePage,
  errorComponent: ({ error, reset }) => <ErrorState error={error} reset={reset} />,
});

function TreePage() {
  const { t } = useTranslation('tree');
  const { familyId } = Route.useParams();
  const { view, person, year, root, scope } = Route.useSearch();
  const locale = usePrefs((s) => s.locale);
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: graph, isPending, error } = useFamilyGraph(familyId);
  // The panel slides in from the end side: right in English, left in Arabic.
  const slide = locale === 'ar' ? -24 : 24;

  const setSearch = useCallback(
    (patch: {
      view?: View;
      person?: string | undefined;
      year?: number | undefined;
      root?: string | undefined;
      scope?: BranchScope | undefined;
    }) => void navigate({ search: (s) => ({ ...s, ...patch }), replace: true }),
    [navigate],
  );
  const onSelect = useCallback((id: string | null) => setSearch({ person: id ?? undefined }), [setSearch]);
  const onYear = useCallback((y: number | null) => setSearch({ year: y ?? undefined }), [setSearch]);

  const bounds = useMemo(() => {
    const years = (graph?.people ?? []).map((p) => partialYear(p.birth)).filter((y): y is number => y != null);
    return { min: years.length ? Math.min(...years) : 1900, max: new Date().getFullYear() };
  }, [graph]);

  const narrowed = useMemo(
    () => (graph && root && scope && graph.people.some((p) => p.id === root) ? narrowGraph(graph, root, scope) : graph),
    [graph, root, scope],
  );

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} />;

  const ViewComponent = COMPONENTS[view];
  const shown = narrowed ?? graph;
  const selected = person && shown.people.some((p) => p.id === person) ? person : null;
  const narrowedTo = shown === graph ? null : (root ?? null);

  return (
    <div className="relative h-[calc(100vh-var(--topbar-height))] overflow-hidden">
      <Suspense fallback={<LoadingState className="h-full" />}>
        {/* A new scope remounts the view so it lays out and fits the smaller set afresh. */}
        <ViewComponent
          key={`${view}:${narrowedTo ?? ''}:${scope ?? ''}`}
          graph={shown}
          selectedId={selected}
          onSelect={onSelect}
          year={year ?? null}
        />
      </Suspense>

      {/* Floating toolbar: view switcher and person search. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start gap-2 p-3">
        <div
          className="glass pointer-events-auto flex max-w-full gap-0.5 overflow-x-auto rounded-full p-1 shadow-lg"
          role="tablist"
        >
          {VIEWS.map((v) => {
            const Icon = ICONS[v];
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={v === view}
                title={t(`viewHints.${v}`)}
                onClick={() => setSearch({ view: v })}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  v === view
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t(`views.${v}`)}</span>
              </button>
            );
          })}
        </div>
        {narrowedTo && scope && (
          <ScopeChip
            graph={graph}
            root={narrowedTo}
            scope={scope}
            locale={locale}
            onClear={() => setSearch({ root: undefined, scope: undefined })}
          />
        )}
        <div className="pointer-events-auto ms-auto w-full max-w-64 sm:w-64">
          <PersonSearch
            people={shown.people}
            onPick={(id) => onSelect(id)}
            placeholder={t('searchPlaceholder')}
            className="glass rounded-full shadow-lg"
          />
        </div>
      </div>

      {/* The studio has its own timeline controls. */}
      {view !== 'studio' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-3">
          <div className="pointer-events-auto">
            <YearSlider min={bounds.min} max={bounds.max} value={year ?? null} onChange={onYear} />
          </div>
        </div>
      )}

      <AnimatePresence>
        {selected && view !== 'person' && (
          <motion.aside
            key="panel"
            initial={{ opacity: 0, x: slide }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: slide }}
            transition={{ duration: 0.2 }}
            className="absolute end-3 top-16 bottom-20 z-20 w-[min(22rem,calc(100%-1.5rem))]"
          >
            <PersonQuickPanel
              graph={shown}
              personId={selected}
              onClose={() => onSelect(null)}
              onSelect={(id) => onSelect(id)}
              scope={narrowedTo === selected ? (scope ?? 'all') : narrowedTo ? null : 'all'}
              onScope={(next) =>
                setSearch(next ? { root: selected, scope: next } : { root: undefined, scope: undefined })
              }
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Shows whose branch the views are narrowed to, with a button back to everyone. */
function ScopeChip({
  graph,
  root,
  scope,
  locale,
  onClear,
}: {
  graph: FamilyGraph;
  root: string;
  scope: BranchScope;
  locale: string;
  onClear: () => void;
}) {
  const { t } = useTranslation('tree');
  const p = graph.people.find((x) => x.id === root);
  if (!p) return null;
  const name = personShortName(p, locale);
  return (
    <div className="glass pointer-events-auto flex h-10 shrink-0 items-center gap-1 rounded-full ps-3 pe-1 text-xs font-semibold shadow-lg">
      <span className="truncate">{t('scope.chip', { name, scope: t(`scope.options.${scope}`) })}</span>
      <button
        type="button"
        onClick={onClear}
        title={t('scope.clear')}
        aria-label={t('scope.clear')}
        className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
