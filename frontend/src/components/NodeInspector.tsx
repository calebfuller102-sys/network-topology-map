import { useEffect, useState } from "react";
import { MonitorPanel } from "./MonitorPanel";
import type {
  ManualRunResponse,
  MonitorPayload,
  MonitorRecord,
  MonitorRunStatus,
  NodeKind,
  NodePayload,
  NodeRecord,
} from "../types";
import { isSupportedIconId, matchingIcons } from "../icons";
import { isRemoteMdiIconId } from "../app/iconId";
import { mergeExternalPosition } from "../app/editorState";

const nodeKinds: NodeKind[] = ["device", "vm", "container", "kubernetes", "service", "cloud", "other"];

function isValidHyperlink(value: string | null): boolean {
  if (!value?.trim()) {
    return true;
  }
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

export interface NodeInspectorProps {
  node: NodeRecord | null;
  defaultPosition: { x: number; y: number };
  resetKey: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: NodePayload) => Promise<void>;
  onDelete: () => Promise<void>;
  monitors: MonitorRecord[];
  liveConnected: boolean;
  onCreateMonitor: (nodeId: string, payload: MonitorPayload) => Promise<MonitorRecord>;
  onUpdateMonitor: (monitorId: string, payload: MonitorPayload) => Promise<MonitorRecord>;
  onDeleteMonitor: (monitorId: string) => Promise<void>;
  onRunMonitor: (monitorId: string) => Promise<ManualRunResponse>;
  onGetMonitorRun: (monitorId: string, runId: string) => Promise<MonitorRunStatus>;
  onRefreshMonitors: () => Promise<void>;
}

function initialDraft(node: NodeRecord | null, defaultPosition: { x: number; y: number }): NodePayload {
  return node
    ? {
        name: node.name,
        kind: node.kind,
        icon_id: node.icon_id,
        hyperlink: node.hyperlink,
        ipv4: node.ipv4,
        display_port: node.display_port,
        x: node.x,
        y: node.y,
      }
    : {
        name: "",
        kind: "device",
        icon_id: "mdi-server",
        hyperlink: null,
        ipv4: null,
        display_port: null,
        x: defaultPosition.x,
        y: defaultPosition.y,
      };
}

export function NodeInspector({
  node,
  defaultPosition,
  resetKey,
  saving,
  onCancel,
  onSave,
  onDelete,
  monitors,
  liveConnected,
  onCreateMonitor,
  onUpdateMonitor,
  onDeleteMonitor,
  onRunMonitor,
  onGetMonitorRun,
  onRefreshMonitors,
}: NodeInspectorProps) {
  const [draft, setDraft] = useState<NodePayload>(() => initialDraft(node, defaultPosition));
  const iconMatches = matchingIcons(draft.icon_id).slice(0, 6);
  const validIconId = isSupportedIconId(draft.icon_id);
  const remoteMdiIcon = isRemoteMdiIconId(draft.icon_id);
  const validHyperlink = isValidHyperlink(draft.hyperlink);

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
      hyperlink: draft.hyperlink?.trim() || null,
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
        <div className="icon-picker">
          <label htmlFor="node-icon-id">Icon</label>
          <input
            id="node-icon-id"
            type="search"
            value={draft.icon_id}
            onChange={(event) => update("icon_id", event.target.value.trim().toLocaleLowerCase())}
            placeholder="mdi-server or si-docker"
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={!validIconId}
            aria-describedby="icon-picker-help"
            required
          />
          <span className="field-help" id="icon-picker-help">
            Search bundled icons, or type any mdi- identifier to load it from Iconify.
          </span>
          {!validIconId ? (
            <p className="field-error" role="alert">
              Enter a valid mdi- icon ID or choose one of the matching bundled icons.
            </p>
          ) : null}
          {remoteMdiIcon ? (
            <p className="field-help" role="status">
              This Material Design icon will load from Iconify. The local fallback appears if it is unavailable.
            </p>
          ) : null}
          <div className="icon-picker-results" role="listbox" aria-label="Matching local icons">
            {iconMatches.map((icon) => (
              <button
                key={icon.id}
                type="button"
                className={`icon-picker-option${icon.id === draft.icon_id ? " is-selected" : ""}`}
                role="option"
                aria-selected={icon.id === draft.icon_id}
                onClick={() => update("icon_id", icon.id)}
              >
                <span aria-hidden="true">{icon.glyph}</span>
                <span>{icon.label}</span>
                <code>{icon.id}</code>
              </button>
            ))}
            {iconMatches.length === 0 ? <span className="field-help">No bundled icons match this search.</span> : null}
          </div>
        </div>
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
        <label>
          Hyperlink
          <input
            type="url"
            inputMode="url"
            value={draft.hyperlink ?? ""}
            onChange={(event) => update("hyperlink", event.target.value || null)}
            placeholder="https://example.internal"
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={!validHyperlink}
            aria-describedby="node-hyperlink-help"
          />
          <span className="field-help" id="node-hyperlink-help">
            Optional HTTP(S) address. Select the node icon to open it in a new tab.
          </span>
          {!validHyperlink ? (
            <p className="field-error" role="alert">
              Enter an absolute HTTP or HTTPS URL without credentials.
            </p>
          ) : null}
        </label>
        <div className="position-readout" aria-label="Node position">
          Position <span>{Math.round(draft.x)}, {Math.round(draft.y)}</span>
        </div>
        <div className="inspector-actions">
          <button type="button" className="button muted" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving || !draft.name.trim() || !validIconId || !validHyperlink}>
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
      {node ? (
        <MonitorPanel
          node={node}
          monitors={monitors}
          saving={saving}
          liveConnected={liveConnected}
          onCreate={onCreateMonitor}
          onUpdate={onUpdateMonitor}
          onDelete={onDeleteMonitor}
          onRun={onRunMonitor}
          onGetRun={onGetMonitorRun}
          onRefresh={onRefreshMonitors}
        />
      ) : null}
    </aside>
  );
}
