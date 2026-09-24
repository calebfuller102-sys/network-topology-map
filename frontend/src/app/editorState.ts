import type { NodePositionChange } from "@xyflow/react";

interface Position {
  x: number;
  y: number;
}

interface PositionedRecord extends Position {
  id: string;
}

/**
 * Applies only actual canvas position updates to API records. React Flow emits
 * selection and dimension changes too; those belong to its transient UI state
 * and must not replace persisted records or editor drafts.
 */
export function applyNodePositionChanges<T extends PositionedRecord>(
  nodes: T[],
  changes: readonly NodePositionChange[],
): T[] {
  const positions = new Map<string, { x: number; y: number }>();

  for (const change of changes) {
    const position = change.position;
    if (
      !position
      || !Number.isFinite(position.x)
      || !Number.isFinite(position.y)
    ) {
      continue;
    }
    positions.set(change.id, position);
  }

  if (positions.size === 0) {
    return nodes;
  }

  let changed = false;
  const updated = nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position || (node.x === position.x && node.y === position.y)) {
      return node;
    }
    changed = true;
    return { ...node, x: position.x, y: position.y };
  });

  return changed ? updated : nodes;
}

/**
 * Merges a canvas movement into a draft without overwriting unsaved form
 * fields. Saving after a drag therefore cannot restore an older coordinate.
 */
export function mergeExternalPosition<T extends Position>(draft: T, position: Position): T {
  if (draft.x === position.x && draft.y === position.y) {
    return draft;
  }
  return { ...draft, x: position.x, y: position.y };
}

/**
 * Drafts reset only for a new selected entity or an explicit completed save.
 * Object replacement from a snapshot or canvas update intentionally does not
 * affect this key.
 */
export function draftResetKey(entityId: string | null, revision: number): string {
  return `${entityId ?? "new"}:${revision}`;
}
