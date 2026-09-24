import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import {
  draftForMonitorKind,
  formatLatency,
  formatLocalTimestamp,
  formatMonitorTarget,
  manualRunFeedback,
  monitorEditorResetKey,
  monitorDraftFor,
  monitorFailureLabel,
  monitorStateLabel,
  validateMonitorDraft,
  type MonitorDraft,
  type MonitorDraftField,
  type MonitorValidationErrors,
} from "../app/monitorState";
import type {
  ManualRunResponse,
  MonitorPayload,
  MonitorRecord,
  MonitorRunStatus,
  NodeRecord,
} from "../types";

interface MonitorPanelProps {
  node: NodeRecord;
  monitors: MonitorRecord[];
  saving: boolean;
  liveConnected: boolean;
  onCreate: (nodeId: string, payload: MonitorPayload) => Promise<MonitorRecord>;
  onUpdate: (monitorId: string, payload: MonitorPayload) => Promise<MonitorRecord>;
  onDelete: (monitorId: string) => Promise<void>;
  onRun: (monitorId: string) => Promise<ManualRunResponse>;
  onGetRun: (monitorId: string, runId: string) => Promise<MonitorRunStatus>;
  onRefresh: () => Promise<void>;
}

type EditorState =
  | { mode: "create"; revision: number; monitor: null }
  | { mode: "edit"; revision: number; monitor: MonitorRecord };

type ManualFeedback = {
  monitorId: string;
  tone: "queued" | "completed" | "unavailable" | "error";
  message: string;
};

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The monitor request could not be completed.";
}

function errorForField(errors: MonitorValidationErrors, field: MonitorDraftField): string | undefined {
  return errors[field];
}

function MonitorEditor({
  node,
  monitor,
  resetKey,
  saving,
  onCancel,
  onSubmit,
}: {
  node: NodeRecord;
  monitor: MonitorRecord | null;
  resetKey: string;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (payload: MonitorPayload) => Promise<void>;
}) {
  const [draft, setDraft] = useState<MonitorDraft>(() => monitorDraftFor(monitor, node));
  const [errors, setErrors] = useState<MonitorValidationErrors>({});

  // `resetKey` changes only for a deliberate selection/new/save action. SSE
  // snapshots replace record objects, so intentionally do not depend on the
  // monitor object here: an in-progress edit remains intact while diagnostics
  // receive fresh results around it.
  useEffect(() => {
    setDraft(monitorDraftFor(monitor, node));
    setErrors({});
  }, [resetKey]);

  const update = <K extends MonitorDraftField>(field: K, value: MonitorDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field] && !current.form) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      delete next.form;
      return next;
    });
  };

  const changeKind = (kind: MonitorDraft["kind"]) => {
    setDraft((current) => draftForMonitorKind(current, kind));
    setErrors({});
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateMonitorDraft(draft);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    try {
      await onSubmit(validation.payload);
    } catch (cause) {
      setErrors({ form: causeMessage(cause) });
    }
  };

  const showHttpFields = draft.kind === "http";
  const needsPort = draft.kind !== "icmp";
  const tlsCanBeDisabled = draft.kind === "http" && draft.scheme === "https";

  return (
    <form className="monitor-form" onSubmit={save} noValidate>
      <div className="monitor-form-heading">
        <div>
          <span className="eyebrow">{monitor ? "Selected check" : "New check"}</span>
          <h3>{monitor ? "Edit monitor" : "Add monitor"}</h3>
        </div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Close monitor editor">×</button>
      </div>
      {errors.form ? <p className="field-error monitor-form-error" role="alert">{errors.form}</p> : null}
      <div className="monitor-field-grid">
        <label>
          Check type
          <select value={draft.kind} onChange={(event) => changeKind(event.target.value as MonitorDraft["kind"])}>
            <option value="icmp">ICMP ping</option>
            <option value="tcp">TCP connection</option>
            <option value="http">HTTP(S) request</option>
          </select>
        </label>
        <label className="checkbox-field">
          <span>Enabled</span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => update("enabled", event.target.checked)}
          />
          <span>{draft.enabled ? "Runs on schedule" : "Excluded from status"}</span>
        </label>
      </div>
      <label>
        Target IPv4
        <input
          value={draft.target_ipv4}
          onChange={(event) => update("target_ipv4", event.target.value)}
          inputMode="decimal"
          placeholder="10.0.0.27"
          aria-invalid={Boolean(errorForField(errors, "target_ipv4"))}
          aria-describedby={errorForField(errors, "target_ipv4") ? "monitor-target-error" : undefined}
          required
        />
        {errorForField(errors, "target_ipv4") ? <span className="field-error" id="monitor-target-error">{errorForField(errors, "target_ipv4")}</span> : null}
      </label>
      {needsPort ? (
        <label>
          Port
          <input
            value={draft.port}
            onChange={(event) => update("port", event.target.value)}
            inputMode="numeric"
            placeholder={draft.kind === "http" ? "80" : "443"}
            aria-invalid={Boolean(errorForField(errors, "port"))}
            aria-describedby={errorForField(errors, "port") ? "monitor-port-error" : undefined}
            required
          />
          {errorForField(errors, "port") ? <span className="field-error" id="monitor-port-error">{errorForField(errors, "port")}</span> : null}
        </label>
      ) : null}
      {showHttpFields ? (
        <>
          <div className="monitor-field-grid">
            <label>
              Scheme
              <select
                value={draft.scheme}
                onChange={(event) => {
                  const scheme = event.target.value as MonitorDraft["scheme"];
                  setDraft((current) => ({ ...current, scheme, verify_tls: scheme === "http" ? true : current.verify_tls }));
                  setErrors((current) => ({ ...current, scheme: undefined, form: undefined }));
                }}
                aria-invalid={Boolean(errorForField(errors, "scheme"))}
              >
                <option value="">Choose scheme</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </select>
              {errorForField(errors, "scheme") ? <span className="field-error">{errorForField(errors, "scheme")}</span> : null}
            </label>
            <label>
              Path
              <input
                value={draft.path}
                onChange={(event) => update("path", event.target.value)}
                placeholder="/"
                aria-invalid={Boolean(errorForField(errors, "path"))}
              />
              {errorForField(errors, "path") ? <span className="field-error">{errorForField(errors, "path")}</span> : null}
            </label>
          </div>
          <label>
            Host header <span className="field-help">Optional</span>
            <input
              value={draft.host_header}
              onChange={(event) => update("host_header", event.target.value)}
              placeholder="service.example.internal"
              aria-invalid={Boolean(errorForField(errors, "host_header"))}
            />
            {errorForField(errors, "host_header") ? <span className="field-error">{errorForField(errors, "host_header")}</span> : null}
          </label>
          <label className="checkbox-field checkbox-field-wide">
            <span>Verify TLS certificate</span>
            <input
              type="checkbox"
              checked={draft.verify_tls}
              disabled={!tlsCanBeDisabled}
              onChange={(event) => update("verify_tls", event.target.checked)}
            />
            <span>{tlsCanBeDisabled ? "Disable only for an explicitly trusted internal exception." : "TLS verification applies to HTTPS only."}</span>
          </label>
        </>
      ) : null}
      <div className="monitor-field-grid">
        <label>
          Interval (seconds)
          <input
            value={draft.interval_seconds}
            onChange={(event) => update("interval_seconds", event.target.value)}
            inputMode="numeric"
            aria-invalid={Boolean(errorForField(errors, "interval_seconds"))}
            required
          />
          {errorForField(errors, "interval_seconds") ? <span className="field-error">{errorForField(errors, "interval_seconds")}</span> : null}
        </label>
        <label>
          Timeout (seconds)
          <input
            value={draft.timeout_seconds}
            onChange={(event) => update("timeout_seconds", event.target.value)}
            inputMode="numeric"
            aria-invalid={Boolean(errorForField(errors, "timeout_seconds"))}
            required
          />
          {errorForField(errors, "timeout_seconds") ? <span className="field-error">{errorForField(errors, "timeout_seconds")}</span> : null}
        </label>
      </div>
      <div className="inspector-actions">
        <button type="button" className="button muted" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="button primary" disabled={saving}>
          {saving ? "Saving…" : monitor ? "Save check" : "Add check"}
        </button>
      </div>
    </form>
  );
}

function MonitorDiagnostics({ monitor }: { monitor: MonitorRecord }) {
  const result = monitor.result;
  const failure = result ? monitorFailureLabel(result) : null;
  return (
    <div className="monitor-diagnostics" aria-label={`Latest result for ${formatMonitorTarget(monitor)}`}>
      <span className="monitor-diagnostics-title">Latest result</span>
      {!result ? <span className="monitor-result-empty">No result recorded yet.</span> : (
        <dl className="monitor-result-grid">
          <div><dt>Checked</dt><dd>{formatLocalTimestamp(result.checked_at)}{result.stale ? " · stale after restart" : ""}</dd></div>
          <div><dt>Outcome</dt><dd>{result.success ? "Passed" : "Failed"}{result.http_status !== null ? ` · HTTP ${result.http_status}` : ""}</dd></div>
          {formatLatency(result.latency_ms) ? <div><dt>Latency</dt><dd>{formatLatency(result.latency_ms)}</dd></div> : null}
          {failure ? <div className="monitor-result-failure"><dt>Reason</dt><dd>{failure}</dd></div> : null}
        </dl>
      )}
    </div>
  );
}

export function MonitorPanel({
  node,
  monitors,
  saving,
  liveConnected,
  onCreate,
  onUpdate,
  onDelete,
  onRun,
  onGetRun,
  onRefresh,
}: MonitorPanelProps) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [feedback, setFeedback] = useState<ManualFeedback | null>(null);
  const [runningMonitorIds, setRunningMonitorIds] = useState<ReadonlySet<string>>(() => new Set());
  const runReceiptTokens = useRef(new Map<string, number>());
  const nextRunReceiptToken = useRef(0);

  const setMonitorRunning = (monitorId: string, running: boolean) => {
    setRunningMonitorIds((current) => {
      const next = new Set(current);
      if (running) {
        next.add(monitorId);
      } else {
        next.delete(monitorId);
      }
      return next;
    });
  };

  // A monitor draft is scoped to a node. Changing selection deliberately
  // discards that node's draft; replacing records from snapshots does not.
  useEffect(() => {
    runReceiptTokens.current.clear();
    setEditor(null);
    setFeedback(null);
    setRunningMonitorIds(new Set());
  }, [node.id]);

  useEffect(() => () => {
    runReceiptTokens.current.clear();
  }, []);

  useEffect(() => {
    const liveIds = new Set(monitors.map((monitor) => monitor.id));
    for (const monitorId of runReceiptTokens.current.keys()) {
      if (!liveIds.has(monitorId)) {
        runReceiptTokens.current.delete(monitorId);
      }
    }
    setRunningMonitorIds((current) => {
      const remaining = [...current].filter((monitorId) => liveIds.has(monitorId));
      return remaining.length === current.size ? current : new Set(remaining);
    });
  }, [monitors]);

  useEffect(() => {
    if (editor?.mode === "edit" && !monitors.some((monitor) => monitor.id === editor.monitor.id)) {
      setEditor(null);
      setFeedback({
        monitorId: editor.monitor.id,
        tone: "error",
        message: "This monitor was removed by a topology update.",
      });
    }
  }, [editor, monitors]);

  const editingMonitor = useMemo(() => {
    if (editor?.mode !== "edit") {
      return null;
    }
    return monitors.find((monitor) => monitor.id === editor.monitor.id) ?? editor.monitor;
  }, [editor, monitors]);

  const saveMonitor = async (payload: MonitorPayload) => {
    if (!editor) {
      return;
    }
    if (editor.mode === "create") {
      const saved = await onCreate(node.id, payload);
      setEditor({ mode: "edit", monitor: saved, revision: editor.revision + 1 });
      return;
    }
    const saved = await onUpdate(editor.monitor.id, payload);
    setEditor({ mode: "edit", monitor: saved, revision: editor.revision + 1 });
  };

  const refreshAfterReceipt = async (monitorId: string, completed: boolean) => {
    try {
      await onRefresh();
    } catch (cause) {
      setFeedback({
        monitorId,
        tone: "error",
        message: completed
          ? `Check completed, but its diagnostics could not refresh: ${causeMessage(cause)}`
          : `Check is unavailable, and diagnostics could not refresh: ${causeMessage(cause)}`,
      });
    }
  };

  const pollRunReceipt = (monitorId: string, runId: string) => {
    const token = nextRunReceiptToken.current + 1;
    nextRunReceiptToken.current = token;
    runReceiptTokens.current.set(monitorId, token);

    const poll = async (): Promise<void> => {
      if (runReceiptTokens.current.get(monitorId) !== token) {
        return;
      }
      try {
        const receipt = await onGetRun(monitorId, runId);
        if (runReceiptTokens.current.get(monitorId) !== token) {
          return;
        }
        if (receipt.status === "queued") {
          window.setTimeout(() => void poll(), 800);
          return;
        }

        runReceiptTokens.current.delete(monitorId);
        setMonitorRunning(monitorId, false);
        if (receipt.status === "completed") {
          // Completion only says the exact manual execution persisted a result.
          // It intentionally does not call that result a success.
          setFeedback({ monitorId, ...manualRunFeedback("completed") });
          await refreshAfterReceipt(monitorId, true);
          return;
        }

        setFeedback({ monitorId, ...manualRunFeedback("unavailable") });
        await refreshAfterReceipt(monitorId, false);
      } catch (cause) {
        if (runReceiptTokens.current.get(monitorId) !== token) {
          return;
        }
        runReceiptTokens.current.delete(monitorId);
        setMonitorRunning(monitorId, false);
        setFeedback({
          monitorId,
          tone: "unavailable",
          message: `Check status is unavailable. Diagnostics will recover from the next live snapshot: ${causeMessage(cause)}`,
        });
        await refreshAfterReceipt(monitorId, false);
      }
    };

    void poll();
  };

  const requestRun = async (monitor: MonitorRecord) => {
    setMonitorRunning(monitor.id, true);
    setFeedback(null);
    try {
      const receipt = await onRun(monitor.id);
      if (receipt.status === "queued") {
        setFeedback({ monitorId: monitor.id, ...manualRunFeedback("queued") });
        pollRunReceipt(monitor.id, receipt.run_id);
      } else {
        setMonitorRunning(monitor.id, false);
        setFeedback({
          monitorId: monitor.id,
          tone: "unavailable",
          message: "Check unavailable — the scheduler did not accept a runnable receipt.",
        });
      }
    } catch (cause) {
      setMonitorRunning(monitor.id, false);
      const unavailable = cause instanceof ApiError && (cause.status === 503 || cause.code === "scheduler_unavailable");
      setFeedback({
        monitorId: monitor.id,
        tone: unavailable ? "unavailable" : "error",
        message: unavailable
          ? "Check unavailable — the monitor scheduler cannot accept work right now."
          : `Unable to queue check: ${causeMessage(cause)}`,
      });
    }
  };

  const removeMonitor = async (monitor: MonitorRecord) => {
    if (!window.confirm(`Delete the ${monitor.kind.toUpperCase()} check for ${monitor.target_ipv4}?`)) {
      return;
    }
    setFeedback(null);
    try {
      await onDelete(monitor.id);
      if (editor?.mode === "edit" && editor.monitor.id === monitor.id) {
        setEditor(null);
      }
    } catch (cause) {
      setFeedback({
        monitorId: monitor.id,
        tone: "error",
        message: `Unable to delete check: ${causeMessage(cause)}`,
      });
    }
  };

  return (
    <section className="monitor-panel" aria-label="Monitor checks and diagnostics">
      <div className="monitor-panel-heading">
        <div>
          <span className="eyebrow">Availability checks</span>
          <h3>Monitors</h3>
        </div>
        <button
          type="button"
          className="button muted monitor-add-button"
          onClick={() => {
            setFeedback(null);
            setEditor({ mode: "create", monitor: null, revision: Date.now() });
          }}
          disabled={saving}
        >
          Add check
        </button>
      </div>
      {!liveConnected ? (
        <p className="monitor-live-warning" role="status">
          Live updates are disconnected. Diagnostics refresh from the API automatically after reconnecting.
        </p>
      ) : null}
      {feedback && !monitors.some((monitor) => monitor.id === feedback.monitorId) ? (
        <p className={`monitor-run-feedback is-${feedback.tone}`} role="status">{feedback.message}</p>
      ) : null}
      {monitors.length === 0 ? (
        <p className="monitor-empty">No checks configured. Add a check to include this node in live availability status.</p>
      ) : (
        <div className="monitor-list">
          {monitors.map((monitor) => {
            const currentFeedback = feedback?.monitorId === monitor.id ? feedback : null;
            const running = runningMonitorIds.has(monitor.id);
            const stateTone = !monitor.enabled
              ? "is-disabled"
              : !monitor.result
                ? "is-awaiting"
                : monitor.result.stale
                  ? "is-stale"
                  : monitor.result.success
                    ? "is-passed"
                    : "is-failed";
            return (
              <article className="monitor-card" key={monitor.id}>
                <div className="monitor-card-heading">
                  <div>
                    <span className="monitor-kind">{monitor.kind === "http" ? "HTTP(S)" : monitor.kind.toUpperCase()}</span>
                    <strong>{formatMonitorTarget(monitor)}</strong>
                  </div>
                  <span className={`monitor-state ${stateTone}`}>
                    {monitorStateLabel(monitor)}
                  </span>
                </div>
                <p className="monitor-config">Every {monitor.interval_seconds}s · timeout {monitor.timeout_seconds}s</p>
                <MonitorDiagnostics monitor={monitor} />
                {currentFeedback ? (
                  <p className={`monitor-run-feedback is-${currentFeedback.tone}`} role="status">{currentFeedback.message}</p>
                ) : null}
                <div className="monitor-card-actions">
                  <button
                    type="button"
                    className="button muted"
                    onClick={() => void requestRun(monitor)}
                    disabled={saving || running || !monitor.enabled}
                    title={!monitor.enabled ? "Enable this monitor before running it" : undefined}
                  >
                    {running ? "Queueing…" : "Check now"}
                  </button>
                  <button
                    type="button"
                    className="button muted"
                    onClick={() => {
                      setFeedback(null);
                      setEditor({ mode: "edit", monitor, revision: Date.now() });
                    }}
                    disabled={saving}
                  >
                    Edit
                  </button>
                  <button type="button" className="danger-button monitor-delete" onClick={() => void removeMonitor(monitor)} disabled={saving}>
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editor ? (
        <MonitorEditor
          key={monitorEditorResetKey(node.id, editor.mode === "edit" ? editor.monitor.id : null, editor.revision)}
          node={node}
          monitor={editingMonitor}
          resetKey={monitorEditorResetKey(node.id, editor.mode === "edit" ? editor.monitor.id : null, editor.revision)}
          saving={saving}
          onCancel={() => setEditor(null)}
          onSubmit={saveMonitor}
        />
      ) : null}
    </section>
  );
}
