import { useEffect, useState, type FormEvent } from "react";
import type { LinkKind, LinkPayload, LinkRecord, NodeRecord } from "../types";

interface LinkInspectorProps {
  link: LinkRecord | null;
  nodes: NodeRecord[];
  resetKey: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: LinkPayload) => Promise<void>;
  onDelete: () => Promise<void>;
}

function initialDraft(link: LinkRecord | null, nodes: NodeRecord[]): LinkPayload {
  return link
    ? {
        source_node_id: link.source_node_id,
        target_node_id: link.target_node_id,
        kind: link.kind,
      }
    : {
        source_node_id: nodes[0]?.id ?? "",
        target_node_id: nodes[1]?.id ?? nodes[0]?.id ?? "",
        kind: "local",
      };
}

export function LinkInspector({ link, nodes, resetKey, saving, onCancel, onSave, onDelete }: LinkInspectorProps) {
  const [draft, setDraft] = useState<LinkPayload>(() => initialDraft(link, nodes));

  useEffect(() => {
    setDraft(initialDraft(link, nodes));
  }, [resetKey]);

  const update = <K extends keyof LinkPayload>(field: K, value: LinkPayload[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave(draft);
  };

  const invalidSelection = !link && (!draft.source_node_id || !draft.target_node_id || draft.source_node_id === draft.target_node_id);

  return (
    <aside className="inspector" aria-label={link ? "Link inspector" : "Add link inspector"}>
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">{link ? "Selected link" : "New link"}</span>
          <h2>{link ? "Edit link" : "Add link"}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Close link inspector">
          ×
        </button>
      </div>
      <form className="node-form" onSubmit={save}>
        <label>
          From
          <select
            value={draft.source_node_id}
            onChange={(event) => update("source_node_id", event.target.value)}
            disabled={Boolean(link)}
            required
          >
            <option value="">Choose a node</option>
            {nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
          </select>
        </label>
        <label>
          To
          <select
            value={draft.target_node_id}
            onChange={(event) => update("target_node_id", event.target.value)}
            disabled={Boolean(link)}
            required
          >
            <option value="">Choose a node</option>
            {nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
          </select>
        </label>
        <label>
          Link type
          <select value={draft.kind} onChange={(event) => update("kind", event.target.value as LinkKind)}>
            <option value="local">Local · solid</option>
            <option value="virtual">Virtual · dashed</option>
          </select>
        </label>
        {!link && draft.source_node_id === draft.target_node_id && draft.source_node_id ? (
          <p className="field-error" role="alert">A node cannot link to itself.</p>
        ) : null}
        <div className="inspector-actions">
          <button type="button" className="button muted" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className="button primary" disabled={saving || invalidSelection}>
            {saving ? "Saving…" : "Save link"}
          </button>
        </div>
        {link ? (
          <button type="button" className="danger-button" onClick={() => void onDelete()} disabled={saving}>
            Delete link
          </button>
        ) : null}
      </form>
    </aside>
  );
}
