import { useEffect, useState } from "react";
import type { NodeKind, NodePayload, NodeRecord } from "../types";
import { ICON_MANIFEST } from "../icons";
import { mergeExternalPosition } from "../app/editorState";

const nodeKinds: NodeKind[] = ["device", "vm", "container", "kubernetes", "service", "cloud", "other"];

export interface NodeInspectorProps {
  node: NodeRecord | null;
  defaultPosition: { x: number; y: number };
  resetKey: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: NodePayload) => Promise<void>;
  onDelete: () => Promise<void>;
}

function initialDraft(node: NodeRecord | null, defaultPosition: { x: number; y: number }): NodePayload {
  return node
    ? {
        name: node.name,
        kind: node.kind,
        icon_id: node.icon_id,
        ipv4: node.ipv4,
        display_port: node.display_port,
        x: node.x,
        y: node.y,
      }
    : {
        name: "",
        kind: "device",
        icon_id: "mdi-server",
        ipv4: null,
        display_port: null,
        x: defaultPosition.x,
        y: defaultPosition.y,
      };
}

export function NodeInspector({ node, defaultPosition, resetKey, saving, onCancel, onSave, onDelete }: NodeInspectorProps) {
  const [draft, setDraft] = useState<NodePayload>(() => initialDraft(node, defaultPosition));

  useEffect(() => {
    setDraft(initialDraft(node, defaultPosition));
  }, [resetKey]);

  useEffect(() => {
    if (!node) {
      return;
    }
    setDraft((current) => mergeExternalPosition(current, node));
  }, [node?.id, node?.x, node?.y]);

  const update = <K extends keyof NodePayload>(field: K, value: NodePayload[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({
      ...draft,
      name: draft.name.trim(),
      ipv4: draft.ipv4?.trim() || null,
      display_port: draft.display_port ? Number(draft.display_port) : null,
    });
  };

  return (
    <aside className="inspector" aria-label={node ? "Node inspector" : "Add node inspector"}>
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">{node ? "Selected node" : "New node"}</span>
          <h2>{node ? "Edit node" : "Add node"}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Close inspector">
          ×
        </button>
      </div>
      <form className="node-form" onSubmit={save}>
        <label>
          Name
          <input
            autoFocus={!node}
            value={draft.name}
            onChange={(event) => update("name", event.target.value)}
            required
            maxLength={200}
          />
        </label>
        <label>
          Type
          <select value={draft.kind} onChange={(event) => update("kind", event.target.value as NodeKind)}>
            {nodeKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          Icon
          <select value={draft.icon_id} onChange={(event) => update("icon_id", event.target.value)} required>
            {!ICON_MANIFEST.some((icon) => icon.id === draft.icon_id) ? (
              <option value={draft.icon_id}>Unsupported saved icon — choose a replacement</option>
            ) : null}
            {ICON_MANIFEST.map((icon) => (
              <option key={icon.id} value={icon.id}>{icon.glyph} {icon.label}</option>
            ))}
          </select>
          <span className="field-help">Icons are resolved from the local allowlisted manifest.</span>
        </label>
        <div className="field-row">
          <label>
            IPv4 address
            <input
              inputMode="decimal"
              value={draft.ipv4 ?? ""}
              onChange={(event) => update("ipv4", event.target.value || null)}
              placeholder="10.0.0.10"
            />
          </label>
          <label>
            Display port
            <input
              type="number"
              min={1}
              max={65535}
              value={draft.display_port ?? ""}
              onChange={(event) => update("display_port", event.target.value ? Number(event.target.value) : null)}
            />
          </label>
        </div>
        <div className="position-readout" aria-label="Node position">
          Position <span>{Math.round(draft.x)}, {Math.round(draft.y)}</span>
        </div>
        <div className="inspector-actions">
          <button type="button" className="button muted" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving || !draft.name.trim()}>
            {saving ? "Saving…" : "Save node"}
          </button>
        </div>
        {node ? (
          <button
            type="button"
            className="danger-button"
            onClick={() => void onDelete()}
            disabled={saving}
          >
            Delete node
          </button>
        ) : null}
      </form>
    </aside>
  );
}
