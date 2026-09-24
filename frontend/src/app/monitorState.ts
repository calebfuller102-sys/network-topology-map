import type {
  HttpScheme,
  MonitorKind,
  MonitorPayload,
  MonitorRecord,
  MonitorResult,
  MonitorRunStatus,
  NodeRecord,
} from "../types";

export interface MonitorDraft {
  kind: MonitorKind;
  enabled: boolean;
  target_ipv4: string;
  port: string;
  scheme: HttpScheme | "";
  path: string;
  host_header: string;
  verify_tls: boolean;
  interval_seconds: string;
  timeout_seconds: string;
}

export type MonitorDraftField = keyof MonitorDraft;
export type MonitorValidationErrors = Partial<Record<MonitorDraftField | "form", string>>;

export type MonitorValidation =
  | { valid: true; payload: MonitorPayload }
  | { valid: false; errors: MonitorValidationErrors };

export type ManualRunFeedback = {
  tone: "queued" | "completed" | "unavailable";
  message: string;
};

/**
 * Snapshot refreshes replace monitor objects. This key intentionally changes
 * only when a user selects a different monitor, starts a new one, or finishes
 * an explicit save, so live result updates cannot erase a form draft.
 */
export function monitorEditorResetKey(nodeId: string, monitorId: string | null, revision: number): string {
  return `${nodeId}:${monitorId ?? "new"}:${revision}`;
}

const errorLabels: Record<string, string> = {
  timeout: "Timeout",
  connection_refused: "Connection refused",
  connection_error: "Connection failure",
  dns_failure: "DNS failure",
  dns_error: "DNS failure",
  unreachable: "Target unreachable",
  http_status: "HTTP failure",
  tls_error: "TLS certificate failure",
  request_error: "HTTP request failure",
  icmp_unavailable: "ICMP unavailable",
  icmp_error: "ICMP failure",
  invalid_check: "Configuration error",
  check_error: "Check error",
  disabled: "Disabled",
};

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function validIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    if (part.length > 1 && part.startsWith("0")) {
      return false;
    }
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
}

function integerInRange(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function monitorDraftFor(
  monitor: MonitorRecord | null,
  node: Pick<NodeRecord, "ipv4">,
): MonitorDraft {
  if (monitor) {
    return {
      kind: monitor.kind,
      enabled: monitor.enabled,
      target_ipv4: monitor.target_ipv4,
      port: monitor.port?.toString() ?? "",
      scheme: monitor.scheme ?? "",
      path: monitor.path ?? "/",
      host_header: monitor.host_header ?? "",
      verify_tls: monitor.verify_tls,
      interval_seconds: monitor.interval_seconds.toString(),
      timeout_seconds: monitor.timeout_seconds.toString(),
    };
  }

  return {
    kind: "icmp",
    enabled: true,
    target_ipv4: node.ipv4 ?? "",
    port: "",
    scheme: "",
    path: "/",
    host_header: "",
    verify_tls: true,
    interval_seconds: "30",
    timeout_seconds: "3",
  };
}

/** Reset fields that are contradictory for a newly chosen monitor kind. */
export function draftForMonitorKind(draft: MonitorDraft, kind: MonitorKind): MonitorDraft {
  if (kind === "icmp") {
    return {
      ...draft,
      kind,
      port: "",
      scheme: "",
      path: "",
      host_header: "",
      verify_tls: true,
    };
  }
  if (kind === "tcp") {
    return {
      ...draft,
      kind,
      scheme: "",
      path: "",
      host_header: "",
      verify_tls: true,
    };
  }
  return {
    ...draft,
    kind,
    scheme: draft.scheme || "http",
    path: draft.path || "/",
  };
}

export function validateMonitorDraft(draft: MonitorDraft): MonitorValidation {
  const errors: MonitorValidationErrors = {};
  const targetIpv4 = draft.target_ipv4.trim();
  if (!validIpv4(targetIpv4)) {
    errors.target_ipv4 = "Enter a valid IPv4 address, such as 10.0.0.27.";
  }

  const interval = integerInRange(draft.interval_seconds, 5, 3600);
  if (interval === null) {
    errors.interval_seconds = "Interval must be a whole number from 5 to 3600 seconds.";
  }
  const timeout = integerInRange(draft.timeout_seconds, 1, 30);
  if (timeout === null) {
    errors.timeout_seconds = "Timeout must be a whole number from 1 to 30 seconds.";
  }

  let port: number | null = null;
  if (draft.kind !== "icmp") {
    port = integerInRange(draft.port, 1, 65535);
    if (port === null) {
      errors.port = "TCP and HTTP(S) checks need a port from 1 to 65535.";
    }
  }

  let scheme: HttpScheme | null = null;
  let path: string | null = null;
  let hostHeader: string | null = null;
  let verifyTls = true;
  if (draft.kind === "http") {
    scheme = draft.scheme || null;
    if (!scheme) {
      errors.scheme = "Choose HTTP or HTTPS.";
    }
    path = trimOrNull(draft.path) ?? "/";
    if (!path.startsWith("/")) {
      errors.path = "HTTP paths must start with '/'.";
    }
    hostHeader = trimOrNull(draft.host_header);
    if (hostHeader?.includes("\r") || hostHeader?.includes("\n")) {
      errors.host_header = "Host header must be a single line.";
    }
    verifyTls = scheme === "https" ? draft.verify_tls : true;
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    payload: {
      kind: draft.kind,
      enabled: draft.enabled,
      target_ipv4: targetIpv4,
      port,
      scheme,
      path,
      host_header: hostHeader,
      verify_tls: verifyTls,
      interval_seconds: interval!,
      timeout_seconds: timeout!,
    },
  };
}

export function formatMonitorTarget(monitor: Pick<MonitorRecord, "kind" | "target_ipv4" | "port" | "scheme" | "path">): string {
  if (monitor.kind === "icmp") {
    return `ICMP ${monitor.target_ipv4}`;
  }
  if (monitor.kind === "tcp") {
    return `TCP ${monitor.target_ipv4}:${monitor.port ?? "?"}`;
  }
  return `${monitor.scheme ?? "http"}://${monitor.target_ipv4}:${monitor.port ?? "?"}${monitor.path ?? "/"}`;
}

export function monitorStateLabel(monitor: Pick<MonitorRecord, "enabled" | "result">): string {
  if (!monitor.enabled) {
    return "Disabled";
  }
  if (!monitor.result) {
    return "Awaiting first result";
  }
  if (monitor.result.stale) {
    return monitor.result.success ? "Stale pass" : "Stale failure";
  }
  return monitor.result.success ? "Passed" : "Failed";
}

export function monitorFailureLabel(result: Pick<MonitorResult, "error_code" | "error_message">): string | null {
  if (!result.error_code && !result.error_message) {
    return null;
  }
  const label = result.error_code ? errorLabels[result.error_code] ?? result.error_code.replaceAll("_", " ") : "Check failure";
  return result.error_message ? `${label}: ${result.error_message}` : label;
}

export function formatLatency(latencyMs: number | null): string | null {
  return latencyMs === null ? null : `${Math.round(latencyMs)} ms`;
}

export function formatLocalTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Time unavailable";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

/** Completion identifies the exact manual execution, never its outcome. */
export function manualRunFeedback(status: MonitorRunStatus["status"]): ManualRunFeedback {
  if (status === "completed") {
    return {
      tone: "completed",
      message: "Check completed — the latest result below shows whether it passed or failed.",
    };
  }
  if (status === "unavailable") {
    return {
      tone: "unavailable",
      message: "Check unavailable — its queued execution could not complete. Diagnostics were refreshed from the API.",
    };
  }
  return {
    tone: "queued",
    message: "Check queued — waiting for the scheduler to report its outcome.",
  };
}
