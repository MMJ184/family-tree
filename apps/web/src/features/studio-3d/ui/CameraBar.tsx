import { cn, focusRingInset } from '@family-tree/ui';
import { Check, CircleHelp, Eye, Focus, Minus, Plus, Scan } from 'lucide-react';
import {
  type Dispatch,
  Fragment,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useId,
  useMemo,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { LabelMode, ViewPreset } from '../engine.ts';
import { VIEW_PRESETS } from './keys.ts';
import { Divider, Kbd, StagePopover, toolClass } from './parts.tsx';

// The camera bar: zoom, framing, camera angle, name labels and help, in one glass pill at the top
// start of the stage, just below the route's toolbar (index.tsx measures where that ends). From 48rem
// of stage width it carries the zoom slider and 32 px buttons for the mouse; narrower it keeps
// 40 px buttons and drops the slider (and, on phones, the branch framing, which the person panel
// would cover anyway). Sizes follow the stage (container queries on the studio wrapper).

export type StageMenu = 'view' | 'help';

const LABEL_MODES: readonly LabelMode[] = ['all', 'branch', 'off'];

/** 40 px targets for touch and on narrow stages; 32 px with a mouse on the full bar. */
const BTN = 'size-10 @3xl:pointer-fine:size-8';

const ITEM = cn(
  'flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-start text-sm transition-colors hover:bg-accent pointer-coarse:py-2.5',
  focusRingInset,
);

/** Under the bar, start-aligned. */
const POP_PLACE = 'start-0 top-full mt-2';

interface CameraBarProps {
  /** The bar's glass pill, measured by the stage layout. */
  barRef: RefObject<HTMLFieldSetElement | null>;
  /** Where focus goes when a panel closes and its button is not shown. */
  stageRef: RefObject<HTMLElement | null>;
  /** Px from the stage top. */
  top: number;
  /** Height limit of the panels, px. */
  popMax: number;
  zoom: number;
  labels: LabelMode;
  /** Move mode is on: drag slides the view (the help panel describes the gestures accordingly). */
  pan: boolean;
  /** Someone is selected, so their branch can be framed. */
  selected: boolean;
  /** The person panel covers the bar (phone-width stages), so it steps aside. */
  covered: boolean;
  reduced: boolean;
  menu: StageMenu | null;
  onMenu: Dispatch<SetStateAction<StageMenu | null>>;
  onZoomStep(dir: 1 | -1): void;
  onZoom(t: number): void;
  onFitAll(): void;
  onFrame(): void;
  onView(view: ViewPreset): void;
  onLabels(mode: LabelMode): void;
}

export function CameraBar(p: CameraBarProps) {
  const { t } = useTranslation('studio');
  const viewBtn = useRef<HTMLButtonElement>(null);
  const helpBtn = useRef<HTMLButtonElement>(null);
  const viewId = useId();
  const helpId = useId();
  const { onMenu } = p;
  // Each panel closes only itself: a closing panel's last blur must not shut the one opening next.
  const closeView = useCallback(() => onMenu((m) => (m === 'view' ? null : m)), [onMenu]);
  const closeHelp = useCallback(() => onMenu((m) => (m === 'help' ? null : m)), [onMenu]);
  const toggle = (m: StageMenu) => onMenu((cur) => (cur === m ? null : m));
  const key = (label: string, k: string) => t('camera.withKey', { label, key: k });
  const pct = Math.round(p.zoom * 100);

  return (
    <div className={cn('absolute start-3 z-20', p.covered && 'invisible')} style={{ top: p.top }}>
      <fieldset
        ref={p.barRef}
        aria-label={t('camera.label')}
        className="glass flex items-center gap-0.5 rounded-full p-1 shadow-lg"
      >
        <button
          type="button"
          className={cn(toolClass(), BTN)}
          onClick={() => p.onZoomStep(-1)}
          aria-label={t('camera.zoomOut')}
          aria-keyshortcuts="-"
          title={key(t('camera.zoomOut'), '−')}
        >
          <Minus aria-hidden />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => p.onZoom(Number(e.target.value) / 100)}
          aria-label={t('camera.zoom')}
          aria-valuetext={t('camera.zoomValue', { value: pct })}
          title={t('camera.zoom')}
          className="mx-1 hidden h-8 w-24 cursor-pointer accent-[var(--ft-primary)] @3xl:block"
        />
        <button
          type="button"
          className={cn(toolClass(), BTN)}
          onClick={() => p.onZoomStep(1)}
          aria-label={t('camera.zoomIn')}
          aria-keyshortcuts="Plus"
          title={key(t('camera.zoomIn'), '+')}
        >
          <Plus aria-hidden />
        </button>
        <Divider className="mx-0.5 h-5 w-px" />
        <button
          type="button"
          className={cn(toolClass(), BTN)}
          onClick={p.onFitAll}
          aria-label={t('camera.fitAll')}
          aria-keyshortcuts="0"
          title={key(t('camera.fitAll'), '0')}
        >
          <Scan aria-hidden />
        </button>
        <button
          type="button"
          className={cn(toolClass(), BTN, 'hidden @min-[28rem]:grid')}
          onClick={() => p.selected && p.onFrame()}
          aria-disabled={!p.selected}
          aria-label={t('camera.frame')}
          aria-keyshortcuts="F"
          title={p.selected ? key(t('camera.frame'), 'F') : t('camera.frameNone')}
        >
          <Focus aria-hidden />
        </button>
        <Divider className="mx-0.5 h-5 w-px" />
        <button
          ref={viewBtn}
          type="button"
          className={cn(toolClass(p.menu === 'view'), BTN)}
          onClick={() => toggle('view')}
          aria-haspopup="dialog"
          aria-expanded={p.menu === 'view'}
          aria-controls={p.menu === 'view' ? viewId : undefined}
          aria-label={t('camera.view')}
          title={t('camera.view')}
        >
          <Eye aria-hidden />
        </button>
        <button
          ref={helpBtn}
          type="button"
          className={cn(toolClass(p.menu === 'help'), BTN)}
          onClick={() => toggle('help')}
          aria-haspopup="dialog"
          aria-expanded={p.menu === 'help'}
          aria-controls={p.menu === 'help' ? helpId : undefined}
          aria-label={t('help.open')}
          aria-keyshortcuts="?"
          title={key(t('help.open'), '?')}
        >
          <CircleHelp aria-hidden />
        </button>
      </fieldset>

      <StagePopover
        id={viewId}
        open={p.menu === 'view'}
        label={t('camera.view')}
        reduced={p.reduced}
        trigger={viewBtn}
        fallback={p.stageRef}
        maxHeight={p.popMax}
        onClose={closeView}
        className={cn(POP_PLACE, 'w-60')}
      >
        <ViewMenu
          labels={p.labels}
          onView={(v) => {
            p.onView(v);
            closeView();
          }}
          onLabels={(m) => {
            p.onLabels(m);
            closeView();
          }}
        />
      </StagePopover>

      <StagePopover
        id={helpId}
        open={p.menu === 'help'}
        label={t('help.open')}
        reduced={p.reduced}
        trigger={helpBtn}
        fallback={p.stageRef}
        maxHeight={p.popMax}
        onClose={closeHelp}
        className={cn(POP_PLACE, 'w-[min(20rem,calc(100cqw-1.5rem))]')}
      >
        <HelpPanel pan={p.pan} />
      </StagePopover>
    </div>
  );
}

function ViewMenu({
  labels,
  onView,
  onLabels,
}: {
  labels: LabelMode;
  onView(v: ViewPreset): void;
  onLabels(m: LabelMode): void;
}) {
  const { t } = useTranslation('studio');
  const angleId = useId();
  const namesId = useId();
  return (
    <div className="grid gap-1">
      <section aria-labelledby={angleId} className="grid">
        <p id={angleId} className="px-2.5 pt-1 pb-1 font-medium text-muted-foreground text-xs">
          {t('camera.angle')}
        </p>
        {VIEW_PRESETS.map((v, i) => (
          <button key={v} type="button" className={ITEM} onClick={() => onView(v)} aria-keyshortcuts={String(i + 1)}>
            <span className="min-w-0 flex-1 truncate">{t(`camera.views.${v}`)}</span>
            <Kbd>{i + 1}</Kbd>
          </button>
        ))}
      </section>
      <Divider className="mx-2.5 h-px" />
      <section aria-labelledby={namesId} className="grid">
        <p id={namesId} className="px-2.5 pt-1 pb-1 font-medium text-muted-foreground text-xs">
          {t('camera.names')}
        </p>
        {LABEL_MODES.map((m) => (
          <button key={m} type="button" className={ITEM} aria-pressed={labels === m} onClick={() => onLabels(m)}>
            <span className="min-w-0 flex-1 truncate">{t(`camera.labels.${m}`)}</span>
            <Check className={cn('size-4 shrink-0 text-primary', labels !== m && 'invisible')} aria-hidden />
          </button>
        ))}
      </section>
    </div>
  );
}

interface HelpRow {
  id: string;
  how: ReactNode;
  does: string;
}

function HelpPanel({ pan }: { pan: boolean }) {
  const { t } = useTranslation('studio');
  // Mouse and keyboard rows for pointer devices, touch rows for touch screens (both on hybrids).
  const [mouse, touch] = useMemo(
    () => [matchMedia('(any-pointer: fine)').matches, matchMedia('(any-pointer: coarse)').matches],
    [],
  );
  const turn = t('help.turn');
  const slide = t('help.slide');
  const desk = mouse || !touch;
  const mouseRows: HelpRow[] = [
    { id: 'drag', how: t('help.drag'), does: pan ? slide : turn },
    { id: 'right', how: t('help.rightDrag'), does: pan ? turn : slide },
    { id: 'wheel', how: t('help.scroll'), does: t('help.zoom') },
    { id: 'pick', how: t('help.clickPortrait'), does: t('help.select') },
    { id: 'empty', how: t('help.clickEmpty'), does: t('help.clear') },
  ];
  const touchRows: HelpRow[] = [
    { id: 'one', how: t('help.oneFinger'), does: pan ? slide : turn },
    { id: 'pinch', how: t('help.pinch'), does: t('help.zoom') },
    { id: 'two', how: t('help.twoFingers'), does: slide },
    { id: 'tap', how: t('help.tapPortrait'), does: t('help.select') },
  ];
  const keyRows: HelpRow[] = [
    { id: 'zoom', how: <Keys keys={['+', '−']} />, does: t('help.zoom') },
    { id: 'fit', how: <Keys keys={['0']} />, does: t('help.fitAll') },
    { id: 'frame', how: <Keys keys={['F']} />, does: t('help.frame') },
    { id: 'views', how: <Keys keys={['1', '4']} range />, does: t('help.views') },
    { id: 'esc', how: <Keys keys={[t('help.esc')]} />, does: t('help.clear') },
    { id: 'help', how: <Keys keys={['?']} />, does: t('help.help') },
  ];
  // One grid for every group, so the gestures and their actions line up across groups.
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 px-2 pt-1 pb-1.5">
      <h2 className="col-span-2 font-semibold text-sm">{t('help.open')}</h2>
      {desk && <HelpGroup title={t('help.mouse')} rows={mouseRows} />}
      {touch && <HelpGroup title={t('help.touch')} rows={touchRows} />}
      {desk && <HelpGroup title={t('help.keyboard')} rows={keyRows} />}
    </div>
  );
}

/** Key caps side by side, or the first and last of a run ("1–4"). */
function Keys({ keys, range = false }: { keys: string[]; range?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.map((k, i) => (
        <Fragment key={k}>
          {range && i > 0 && <span>–</span>}
          <Kbd>{k}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}

function HelpGroup({ title, rows }: { title: string; rows: HelpRow[] }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="col-span-2 grid grid-cols-subgrid gap-y-1.5">
      <h3 id={id} className="col-span-2 font-medium text-muted-foreground text-xs">
        {title}
      </h3>
      <dl className="col-span-2 grid grid-cols-subgrid items-center gap-y-1.5 text-[13px]">
        {rows.map((r) => (
          <Fragment key={r.id}>
            <dt className="text-muted-foreground">{r.how}</dt>
            <dd className="text-foreground">{r.does}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
