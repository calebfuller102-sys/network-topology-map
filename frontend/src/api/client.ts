import type {
  LinkPayload,
  LinkRecord,
  LinkKind,
  GroupPayload,
  GroupRecord,
  ManualRunResponse,
  MapRecord,
  MonitorPayload,
  MonitorRunStatus,
  MonitorRecord,
  NodePayload,
  NodeRecord,
  Snapshot,
} from "../types";
import { apiErrorInfo } from "./errors";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      // Preserve the HTTP status when a gateway returns a non-JSON error.
    }
    const error = apiErrorInfo(body, response.status);
    throw new ApiError(
      response.status,
      error.code,
      error.message,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  eventsUrl: (mapId: string, after: number) =>
    `${API_BASE}/maps/${encodeURIComponent(mapId)}/events?after=${encodeURIComponent(String(after))}`,
  listMaps: () => request<MapRecord[]>("/maps"),
  getSnapshot: (mapId: string) => request<Snapshot>(`/maps/${mapId}/snapshot`),
  createNode: (mapId: string, payload: NodePayload) =>
    request<NodeRecord>(`/maps/${mapId}/nodes`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createGroup: (mapId: string, payload: GroupPayload) =>
    request<GroupRecord>(`/maps/${mapId}/groups`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  patchGroup: (groupId: string, payload: Partial<GroupPayload>) =>
    request<GroupRecord>(`/groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteGroup: (groupId: string) =>
    request<void>(`/groups/${groupId}`, { method: "DELETE" }),
  patchNode: (nodeId: string, payload: NodePayload) =>
    request<NodeRecord>(`/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteNode: (nodeId: string) =>
    request<void>(`/nodes/${nodeId}`, {
      method: "DELETE",
    }),
  createLink: (mapId: string, payload: LinkPayload) =>
    request<LinkRecord>(`/maps/${mapId}/links`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  patchLink: (linkId: string, kind: LinkKind) =>
    request<LinkRecord>(`/links/${linkId}`, {
      method: "PATCH",
      body: JSON.stringify({ kind }),
    }),
  deleteLink: (linkId: string) =>
    request<void>(`/links/${linkId}`, {
      method: "DELETE",
    }),
  patchNodePosition: (nodeId: string, x: number, y: number, group_id?: string | null) =>
    request<NodeRecord>(`/nodes/${nodeId}/position`, {
      method: "PATCH",
      body: JSON.stringify({ x, y, ...(group_id === undefined ? {} : { group_id }) }),
    }),
  patchViewport: (
    mapId: string,
    viewport_x: number,
    viewport_y: number,
    viewport_zoom: number,
    keepalive = false,
  ) =>
    request<MapRecord>(`/maps/${mapId}`, {
      method: "PATCH",
      body: JSON.stringify({ viewport_x, viewport_y, viewport_zoom }),
      keepalive,
    }),
  createMonitor: (nodeId: string, payload: MonitorPayload) =>
    request<MonitorRecord>(`/nodes/${nodeId}/monitors`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  patchMonitor: (monitorId: string, payload: MonitorPayload) =>
    request<MonitorRecord>(`/monitors/${monitorId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteMonitor: (monitorId: string) =>
    request<void>(`/monitors/${monitorId}`, {
      method: "DELETE",
    }),
  runMonitor: (monitorId: string) =>
    request<ManualRunResponse>(`/monitors/${monitorId}/run`, {
      method: "POST",
    }),
  getMonitorRun: (monitorId: string, runId: string) =>
    request<MonitorRunStatus>(`/monitors/${monitorId}/runs/${runId}`),
};
