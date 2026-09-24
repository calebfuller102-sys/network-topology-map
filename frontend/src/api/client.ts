import type { LinkPayload, LinkRecord, LinkKind, MapRecord, NodePayload, NodeRecord, Snapshot } from "../types";

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

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
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
    let body: ErrorEnvelope = {};
    try {
      body = (await response.json()) as ErrorEnvelope;
    } catch {
      // Preserve the HTTP status when a gateway returns a non-JSON error.
    }
    throw new ApiError(
      response.status,
      body.error?.code ?? "request_failed",
      body.error?.message ?? `Request failed with status ${response.status}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  listMaps: () => request<MapRecord[]>("/maps"),
  getSnapshot: (mapId: string) => request<Snapshot>(`/maps/${mapId}/snapshot`),
  createNode: (mapId: string, payload: NodePayload) =>
    request<NodeRecord>(`/maps/${mapId}/nodes`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
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
  patchNodePosition: (nodeId: string, x: number, y: number) =>
    request<NodeRecord>(`/nodes/${nodeId}/position`, {
      method: "PATCH",
      body: JSON.stringify({ x, y }),
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
};
