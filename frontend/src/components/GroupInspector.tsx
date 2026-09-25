import { useEffect, useState, type FormEvent } from "react";
import type { GroupPayload, GroupRecord } from "../types";

interface GroupInspectorProps {
  group: GroupRecord | null;
  defaultPosition: { x: number; y: number };
  resetKey: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: GroupPayload) => Promise<void>;
  onDelete: () => Promise<void>;
}

function initialDraft(group: GroupRecord | null, defaultPosition: { x: number; y: number }): GroupPayload {
  return group ?? { name: "New group", x: defaultPosition.x, y: defaultPosition.y, width: 360, height: 240 };
}

export function GroupInspector({
  group, defaultPosition, resetKey, saving, onCancel, onSave, onDelete,
}: GroupInspectorProps) {
  const [draft, setDraft] = useState<GroupPayload>(() => initialDraft(group, defaultPosition));

  useEffect(() => setDraft(initialDraft(group, defaultPosition)), [resetKey]);
  const update = <K extends keyof GroupPayload>(field: K, value: GroupPayload[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({ ...draft, name: draft.name.trim() });
  };

  return (
    <aside className="inspector" aria-label={group ? "Group inspector" : "Add group inspector"}>
      <div className="inspector-heading">
        <div><span className="eyebrow">{group ? "Selected group" : "New group"}</span><h2>{group ? "Edit group" : "Add group"}</h2></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Close group inspector">×</button>
      </div>
      <form className="node-form" onSubmit={save}>
        <label>Name<input autoFocus={!group} value={draft.name} onChange={(event) => update("name", event.target.value)} required maxLength={100} /></label>
        <div className="field-row">
          <label>Width<input type="number" min={260} value={draft.width} onChange={(event) => update("width", Number(event.target.value))} required /></label>
          <label>Height<input type="number" min={160} value={draft.height} onChange={(event) => update("height", Number(event.target.value))} required /></label>
        </div>
        <span className="field-help">Move the group to move its contained nodes. Drop a node inside to add it; drag it out to remove it.</span>
        <div className="inspector-actions">
          <button type="button" className="button muted" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className="button primary" disabled={saving || !draft.name.trim()}> {saving ? "Saving…" : "Save group"}</button>
        </div>
        {group ? <button type="button" className="danger-button" onClick={() => void onDelete()} disabled={saving}>Delete group</button> : null}
      </form>
    </aside>
  );
}
