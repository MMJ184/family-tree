import { generations, type Person, partialYear } from '@family-tree/shared';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TreeViewProps } from '#/entities/tree/types.ts';
import { buildModel, hasBusinessBy } from './model.ts';
import { PersonCard } from './PersonCard.tsx';

interface Generation {
  n: number;
  people: Person[];
  from: number | null;
  to: number | null;
}

export function GenerationView({ graph, selectedId, onSelect, year }: TreeViewProps) {
  const { t } = useTranslation('tree2d');
  const model = useMemo(() => buildModel(graph), [graph]);
  const genOf = useMemo(
    () =>
      generations(
        { parentChild: graph.parentChild, marriages: graph.marriages },
        graph.people.map((p) => p.id),
      ),
    [graph],
  );

  const rows = useMemo<Generation[]>(() => {
    const groups = new Map<number, Person[]>();
    for (const p of graph.people) {
      const b = partialYear(p.birth);
      if (year != null && b != null && b > year) continue;
      const g = genOf.get(p.id) ?? 0;
      const list = groups.get(g) ?? [];
      list.push(p);
      groups.set(g, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([g, people]) => {
        people.sort(
          (a, b) =>
            (partialYear(a.birth) ?? 9999) - (partialYear(b.birth) ?? 9999) || a.firstName.localeCompare(b.firstName),
        );
        const years = people.map((p) => partialYear(p.birth)).filter((y): y is number => y != null);
        return {
          n: g + 1,
          people,
          from: years.length ? Math.min(...years) : null,
          to: years.length ? Math.max(...years) : null,
        };
      });
  }, [graph.people, genOf, year]);

  const total = rows.reduce((s, r) => s + r.people.length, 0);

  // Search jump: scroll the selected card into view.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    // Wait for the rows' entrance animation so the position is final.
    const timer = setTimeout(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-person="${CSS.escape(selectedId)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }, 450);
    return () => clearTimeout(timer);
  }, [selectedId]);

  return (
    <div ref={scroller} className="h-full overflow-y-auto">
      <div
        className={`mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-20 pb-32 sm:px-6 ${selectedId ? 'lg:pe-[24rem]' : ''}`}
      >
        <p className="text-sm text-muted-foreground">
          {year != null && total === 0
            ? t('emptyYear', { year })
            : t('generation.total', { count: total, gens: rows.length })}
        </p>
        {rows.map((row, i) => (
          <motion.section
            key={row.n}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.05, 0.4) }}
            className="glass rounded-3xl p-4 shadow-sm sm:p-5"
          >
            <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-display text-lg font-semibold">{t('generation.title', { n: row.n })}</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {t('generation.count', { count: row.people.length })}
              </span>
              {row.from != null && row.to != null && (
                <span className="text-xs text-muted-foreground">
                  <Trans
                    t={t}
                    i18nKey="generation.span"
                    values={{ from: row.from, to: row.to }}
                    components={{ y: <span className="ltr-isolate tabular-nums" /> }}
                  />
                </span>
              )}
            </header>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-2.5">
              {row.people.map((p) => (
                <div key={p.id} data-person={p.id} className="scroll-mt-24 scroll-mb-28">
                  <PersonCard
                    person={p}
                    selected={p.id === selectedId}
                    marriedIn={model.marriedIn.has(p.id)}
                    business={hasBusinessBy(model, p.id, year)}
                    onClick={() => onSelect(p.id)}
                  />
                </div>
              ))}
            </div>
          </motion.section>
        ))}
      </div>
    </div>
  );
}
