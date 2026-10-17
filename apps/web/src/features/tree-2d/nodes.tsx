import type { Person } from '@family-tree/shared';
import { cn } from '@family-tree/ui';
import { Handle, type Node, type NodeProps, Position, type ReactFlowState, useStore } from '@xyflow/react';
import { Briefcase, ChevronDown, ChevronUp, HeartHandshake } from 'lucide-react';
import { createContext, memo, useContext } from 'react';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import { CARD_H, CARD_W, UNION_SIZE } from './layout.ts';

// Light React Flow node components. Everything they need arrives in `data` (stable
// objects, rebuilt only when that node changes) or through a context that only
// changes with the language, so panning and the year slider do not re-render every card.

export type PersonNodeData = {
  person: Person;
  name: string;
  years: string;
  marriedIn: boolean;
  business: boolean;
  canToggle: boolean;
  collapsed: boolean;
  hiddenCount: number;
};
export type UnionNodeData = { year: number | null; ended: boolean };

export type PersonFlowNode = Node<PersonNodeData, 'person'>;
export type UnionFlowNode = Node<UnionNodeData, 'union'>;
export type TreeFlowNode = PersonFlowNode | UnionFlowNode;

export interface TreeNodeContext {
  onToggle: (personId: string) => void;
  labels: { business: string; marriedIn: string; deceased: string; collapse: string; expand: string };
}

export const TreeNodeCtx = createContext<TreeNodeContext>({
  onToggle: () => {},
  labels: { business: '', marriedIn: '', deceased: '', collapse: '', expand: '' },
});

export function genderColor(g: Person['gender']): string {
  return g === 'FEMALE' ? 'var(--ft-female)' : g === 'MALE' ? 'var(--ft-male)' : 'var(--ft-gold)';
}

/** Below this zoom, cards are unreadable anyway: draw them as light blocks. */
const farSelector = (s: ReactFlowState) => s.transform[2] < 0.32;

const PersonNode = memo(function PersonNode({ id, data, selected }: NodeProps<PersonFlowNode>) {
  const { onToggle, labels } = useContext(TreeNodeCtx);
  // Far zoom: a plain coloured block with the name (re-renders only when crossing the threshold).
  const far = useStore(farSelector);
  const p = data.person;
  const living = p.isLiving;
  if (far) {
    return (
      <div
        className={cn(
          'flex items-center rounded-2xl border border-border px-4',
          living ? 'bg-card text-card-foreground' : 'bg-muted text-muted-foreground',
          selected && 'ring-4 ring-primary',
        )}
        style={{
          width: CARD_W,
          height: CARD_H,
          borderInlineStartWidth: 10,
          borderInlineStartColor: genderColor(p.gender),
        }}
      >
        <Handle type="target" position={Position.Top} isConnectable={false} />
        <span className="truncate font-bold text-xl">{data.name}</span>
        <Handle type="source" position={Position.Bottom} isConnectable={false} />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'ft-card relative flex items-center gap-2.5 rounded-2xl border border-border ps-3 pe-2.5 shadow-sm transition-[box-shadow,transform,background-color] duration-200',
        living ? 'bg-card text-card-foreground' : 'bg-muted text-muted-foreground',
        selected
          ? 'scale-[1.04] shadow-xl ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'hover:-translate-y-0.5 hover:shadow-md',
      )}
      style={{
        width: CARD_W,
        height: CARD_H,
        borderInlineStartWidth: 4,
        borderInlineStartColor: genderColor(p.gender),
      }}
      title={living ? undefined : labels.deceased}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <PersonAvatar photoUrl={p.photoUrl} gender={p.gender} name={data.name} isLiving={living} size={38} />
      <div className="min-w-0 flex-1">
        <div className={cn('ft-card-name truncate text-sm font-semibold leading-tight', !living && 'font-medium')}>
          {data.name}
        </div>
        <div className="ft-card-detail mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.years && <span className="ltr-isolate tabular-nums">{data.years}</span>}
          {data.marriedIn && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-accent-foreground"
              title={labels.marriedIn}
            >
              <HeartHandshake className="size-3" aria-hidden />
              <span className="sr-only">{labels.marriedIn}</span>
            </span>
          )}
        </div>
      </div>
      {data.business && (
        <span
          className="-top-2 absolute end-2 grid size-5 place-items-center rounded-full bg-gold text-gold-foreground shadow ring-2 ring-card"
          title={labels.business}
        >
          <Briefcase className="size-3" aria-hidden />
          <span className="sr-only">{labels.business}</span>
        </span>
      )}
      {data.canToggle && (
        <button
          type="button"
          className={cn(
            'nodrag nopan -bottom-3 absolute inset-x-0 mx-auto flex h-6 w-fit min-w-6 items-center justify-center gap-0.5 rounded-full border border-border px-1.5 text-[11px] font-semibold shadow-sm transition-colors',
            data.collapsed
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
          aria-label={data.collapsed ? labels.expand : labels.collapse}
          title={data.collapsed ? labels.expand : labels.collapse}
          aria-expanded={!data.collapsed}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(id);
          }}
        >
          {data.collapsed ? (
            <>
              <ChevronDown className="size-3.5" aria-hidden />
              <span className="ltr-isolate tabular-nums">+{data.hiddenCount}</span>
            </>
          ) : (
            <ChevronUp className="size-3.5" aria-hidden />
          )}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

const UnionNode = memo(function UnionNode({ data }: NodeProps<UnionFlowNode>) {
  const far = useStore(farSelector);
  if (far) {
    return (
      <div className="grid place-items-center" style={{ width: UNION_SIZE, height: UNION_SIZE }}>
        <Handle type="target" position={Position.Top} isConnectable={false} />
        <span className="block size-3 rounded-full bg-gold" />
        <Handle type="source" position={Position.Bottom} isConnectable={false} />
      </div>
    );
  }
  return (
    <div className="ft-union relative grid place-items-center" style={{ width: UNION_SIZE, height: UNION_SIZE }}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span
        className={cn(
          'block size-2.5 rounded-full border-2 border-gold',
          data.ended
            ? 'bg-background'
            : 'bg-gold shadow-[0_0_0_3px_color-mix(in_oklab,var(--ft-gold)_25%,transparent)]',
        )}
      />
      {data.year != null && (
        <span className="ft-card-detail ltr-isolate pointer-events-none absolute start-full top-1/2 ms-1 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-muted-foreground tabular-nums">
          {data.year}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

export const nodeTypes = { person: PersonNode, union: UnionNode };
