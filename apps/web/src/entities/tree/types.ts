import type { FamilyGraph } from '@family-tree/shared';

/** Props every tree view component accepts (2D tree, graph, mind map, 3D studio...). */
export interface TreeViewProps {
  graph: FamilyGraph;
  /** The highlighted person, or null. */
  selectedId: string | null;
  /** Called when the user clicks a person. */
  onSelect: (personId: string | null) => void;
  /** The time slider's year: people born after it are hidden. null = present day, show everyone. */
  year: number | null;
}
