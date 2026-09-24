import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorInfo } from "../src/api/errors.ts";
import {
  draftForMonitorKind,
  formatMonitorTarget,
  manualRunFeedback,
  monitorEditorResetKey,
  monitorFailureLabel,
  monitorStateLabel,
  validateMonitorDraft,
  type MonitorDraft,
} from "../src/app/monitorState.ts";

function httpDraft(overrides: Partial<MonitorDraft> = {}): MonitorDraft {
  return {
    kind: "http",
    enabled: true,
    target_ipv4: "10.0.0.27",
    port: "443",
    scheme: "https",
    path: "/health",
    host_header: "fixture.internal",
    verify_tls: true,
    interval_seconds: "30",
    timeout_seconds: "3",
    ...overrides,
  };
}

test("monitor editor validates each check kind before it reaches the API", () => {
  const valid = validateMonitorDraft(httpDraft());
  assert.equal(valid.valid, true);
  if (!valid.valid) {
    assert.fail("Expected a valid HTTP monitor draft.");
  }
  assert.deepEqual(valid.payload, {
    kind: "http",
    enabled: true,
    target_ipv4: "10.0.0.27",
    port: 443,
    scheme: "https",
    path: "/health",
    host_header: "fixture.internal",
    verify_tls: true,
    interval_seconds: 30,
    timeout_seconds: 3,
  });

  const invalid = validateMonitorDraft(httpDraft({
    target_ipv4: "01.2.3.4",
    port: "65536",
    path: "health",
    interval_seconds: "4",
    timeout_seconds: "31",
  }));
  assert.equal(invalid.valid, false);
  if (invalid.valid) {
    assert.fail("Expected validation errors.");
  }
  assert.match(invalid.errors.target_ipv4 ?? "", /IPv4/);
  assert.match(invalid.errors.port ?? "", /1 to 65535/);
  assert.match(invalid.errors.path ?? "", /start/);
  assert.match(invalid.errors.interval_seconds ?? "", /5 to 3600/);
  assert.match(invalid.errors.timeout_seconds ?? "", /1 to 30/);

  const tcp = draftForMonitorKind(httpDraft({ verify_tls: false }), "tcp");
  assert.equal(tcp.scheme, "");
  assert.equal(tcp.path, "");
  assert.equal(tcp.host_header, "");
  assert.equal(tcp.verify_tls, true);
});

test("server validation details are shown as field-specific monitor errors", () => {
  const error = apiErrorInfo({
    error: {
      code: "validation_error",
      message: "Request validation failed",
      details: [{ loc: ["body", "target_ipv4"], message: "Input is not a valid IPv4 address" }],
    },
  }, 422);
  assert.equal(error.code, "validation_error");
  assert.equal(error.message, "target_ipv4: Input is not a valid IPv4 address");
});

test("monitor draft reset keys preserve edits across a live record replacement", () => {
  const initial = monitorEditorResetKey("node-a", "monitor-a", 10);
  const refreshedSameMonitor = monitorEditorResetKey("node-a", "monitor-a", 10);
  const selectedDifferentMonitor = monitorEditorResetKey("node-a", "monitor-b", 10);
  const savedMonitor = monitorEditorResetKey("node-a", "monitor-a", 11);
  const selectedDifferentNode = monitorEditorResetKey("node-b", "monitor-a", 10);

  assert.equal(initial, refreshedSameMonitor);
  assert.notEqual(initial, selectedDifferentMonitor);
  assert.notEqual(initial, savedMonitor);
  assert.notEqual(initial, selectedDifferentNode);
});

test("manual-run feedback distinguishes queueing, execution completion, and unavailable receipts", () => {
  const queued = manualRunFeedback("queued");
  const completed = manualRunFeedback("completed");
  const unavailable = manualRunFeedback("unavailable");

  assert.equal(queued.tone, "queued");
  assert.match(queued.message, /queued/i);
  assert.equal(completed.tone, "completed");
  assert.match(completed.message, /whether it passed or failed/i);
  assert.equal(unavailable.tone, "unavailable");
  assert.match(unavailable.message, /could not complete/i);
});

test("diagnostics retain concise failure details without implying a passed result", () => {
  assert.equal(
    formatMonitorTarget({ kind: "http", target_ipv4: "127.0.0.1", port: 8080, scheme: "http", path: "/health" }),
    "http://127.0.0.1:8080/health",
  );
  assert.equal(
    monitorFailureLabel({ error_code: "connection_refused", error_message: "TCP connection was refused" }),
    "Connection refused: TCP connection was refused",
  );
  assert.equal(monitorStateLabel({ enabled: true, result: null }), "Awaiting first result");
  assert.equal(monitorStateLabel({ enabled: false, result: null }), "Disabled");
});
