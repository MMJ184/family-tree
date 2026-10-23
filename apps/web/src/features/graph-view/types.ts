import type { VisibleData } from './model.ts';
import type { PaintCtx } from './paint.ts';

/** Mutable state shared between the React component and the imperative graph instance. */
export interface ViewCtl extends PaintCtx {
  nb: Map<string, Set<string>>;
  onSelect: (id: string | null) => void;
  /** Bumped when fonts or photos finish loading, so cached card textures repaint. */
  rev: number;
  /** Called when the force layout comes to rest. */
  onSettled: () => void;
}

export interface GraphHandle {
  /** Replaces the shown nodes and links (`force` re-sends even when the set looks unchanged). */
  setData(d: VisibleData, force: boolean): void;
  /** Repaints after colours, language, year or selection changed. */
  refresh(): void;
  /** Zooms so the person's branch (ids from `branchOf`) fits the free screen area. */
  focus(id: string, branch: ReadonlySet<string>): void;
  fit(ms?: number): void;
  resize(w: number, h: number): void;
  destroy(): void;
}

export const isOn = (ctl: ViewCtl, id: string) =>
  !ctl.hoverId || id === ctl.hoverId || !!ctl.nb.get(ctl.hoverId)?.has(id);

/** Half the width the person panel covers at the end side (0 on small screens). */
export const panelShift = (width: number) => (width >= 768 ? (Math.min(352, width - 24) + 12) / 2 : 0);

/** Screen space the floating toolbars take at the top and the year slider at the bottom. */
export const VIEW_TOP = 112;
export const VIEW_BOTTOM = 88;
