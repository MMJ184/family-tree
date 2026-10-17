import ElkConstructor, { type ELK, type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { TreeModel } from './model.ts';

// ELK layered layout, run in a web worker so a 500-person family does not block the UI.

export const CARD_W = 216;
export const CARD_H = 64;
export const UNION_SIZE = 14;

export interface Point {
  x: number;
  y: number;
}

let elk: ELK | null = null;
function getElk(): ELK {
  elk ??= new ElkConstructor({ workerUrl: elkWorkerUrl });
  return elk;
}

/** Top-left positions of every laid-out person and union (LTR; mirror for Arabic at render time). */
export async function layoutTree(model: TreeModel, hidden: ReadonlySet<string>): Promise<Map<string, Point>> {
  const children: ElkNode[] = [];
  for (const id of model.order) {
    if (hidden.has(id)) continue;
    const u = model.unionById.get(id);
    if (u) {
      if (hidden.has(u.a) && (u.b == null || hidden.has(u.b))) continue;
      children.push({ id, width: UNION_SIZE, height: UNION_SIZE });
    } else {
      children.push({ id, width: CARD_W, height: CARD_H });
    }
  }
  const present = new Set(children.map((c) => c.id));
  const edges: ElkExtendedEdge[] = [];
  for (const u of model.unions) {
    if (!present.has(u.id)) continue;
    for (const p of [u.a, u.b]) {
      if (p != null && present.has(p)) edges.push({ id: `${p}>${u.id}`, sources: [p], targets: [u.id] });
    }
    for (const k of u.kids) if (present.has(k)) edges.push({ id: `${u.id}>${k}`, sources: [u.id], targets: [k] });
  }
  const res = await getElk().layout({
    id: 'root',
    children,
    edges,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': children.length > 400 ? 'BRANDES_KOEPF' : 'NETWORK_SIMPLEX',
      'elk.spacing.nodeNode': '26',
      'elk.layered.spacing.nodeNodeBetweenLayers': '38',
      'elk.separateConnectedComponents': 'false',
    },
  });
  const out = new Map<string, Point>();
  for (const c of res.children ?? []) out.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  return out;
}
