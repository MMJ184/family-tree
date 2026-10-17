import { type GLink, type GNode, nid } from './model.ts';
import { cardSize } from './paint.ts';

// Force settings from the accepted prototype (Obsidian-like defaults, scaled for cards).

const REPEL = 110;
const DIST = 30;

/** Keeps cards from overlapping: boxes in 2D, spheres in 3D. */
export function cardCollide() {
  let nodes: GNode[] = [];
  const force = () => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i] as GNode;
      const [aw, ah] = cardSize(a);
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j] as GNode;
        const [bw, bh] = cardSize(b);
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        if (a.z !== undefined && b.z !== undefined) {
          const dz = b.z - a.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          const min = (aw + bw) / 2.6;
          if (d < min) {
            const k = ((min - d) / d) * 0.25;
            a.vx = (a.vx ?? 0) - dx * k;
            a.vy = (a.vy ?? 0) - dy * k;
            a.vz = (a.vz ?? 0) - dz * k;
            b.vx = (b.vx ?? 0) + dx * k;
            b.vy = (b.vy ?? 0) + dy * k;
            b.vz = (b.vz ?? 0) + dz * k;
          }
          continue;
        }
        const ox = (aw + bw) / 2 + 8 - Math.abs(dx);
        const oy = (ah + bh) / 2 + 8 - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            const m = ox * 0.25 * (dx < 0 ? -1 : 1);
            a.vx = (a.vx ?? 0) - m;
            b.vx = (b.vx ?? 0) + m;
          } else {
            const m = oy * 0.25 * (dy < 0 ? -1 : 1);
            a.vy = (a.vy ?? 0) - m;
            b.vy = (b.vy ?? 0) + m;
          }
        }
      }
    }
  };
  force.initialize = (ns: GNode[]) => {
    nodes = ns;
  };
  return force;
}

interface ForceHost {
  // biome-ignore lint/suspicious/noExplicitAny: d3 force objects are untyped in force-graph's typings.
  d3Force(name: string): any;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  d3Force(name: string, fn: any): unknown;
  d3ReheatSimulation(): unknown;
}

export function applyForces(f: ForceHost) {
  const d = DIST * 2.6;
  f.d3Force('charge').strength(-REPEL * 3);
  f.d3Force('link')
    .distance((l: GLink) => (l.kind === 'sp' ? d * 0.6 : l.kind === 'bz' ? d * 1.1 : d))
    .strength((l: GLink) => (l.kind === 'sp' ? 0.7 : 0.55));
  if (!f.d3Force('collide')) f.d3Force('collide', cardCollide());
  f.d3ReheatSimulation();
}

export const isHiLink = (l: GLink, hoverId: string | null) =>
  !!hoverId && (nid(l.source) === hoverId || nid(l.target) === hoverId);
