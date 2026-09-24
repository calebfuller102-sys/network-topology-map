export type NodeKind =
  | "device"
  | "vm"
  | "container"
  | "kubernetes"
  | "service"
  | "cloud"
  | "other";

export type LinkKind = "local" | "virtual";

export type Status = "unknown" | "online" | "degraded" | "offline";

export interface MapRecord {
  id: string;
  name: string;
  viewport_x: number;
  viewport_y: number;
  viewport_zoom: number;
  created_at: string;
  updated_at: string;
}

export interface NodeRecord {
  id: string;
  map_id: string;
  name: string;
  kind: NodeKind;
  icon_id: string;
  ipv4: string | null;
  display_port: number | null;
  x: number;
  y: number;
  created_at: string;
  updated_at: string;
}

export interface LinkRecord {
  id: string;
  map_id: string;
  source_node_id: string;
  target_node_id: string;
  kind: LinkKind;
  created_at: string;
}

export interface LinkPayload {
  source_node_id: string;
  target_node_id: string;
  kind: LinkKind;
}

export interface MonitorResult {
  monitor_id: string;
  success: boolean;
  checked_at: string;
  latency_ms: number | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  stale: boolean;
}

export interface MonitorRecord {
  id: string;
  node_id: string;
  kind: "icmp" | "tcp" | "http";
  enabled: boolean;
  target_ipv4: string;
  port: number | null;
  scheme: "http" | "https" | null;
  path: string | null;
  host_header: string | null;
  verify_tls: boolean;
  interval_seconds: number;
  timeout_seconds: number;
  created_at: string;
  updated_at: string;
  result: MonitorResult | null;
}

export interface MonitorSummary {
  id: string;
  kind: MonitorRecord["kind"];
  success: boolean | null;
  checked_at: string | null;
  error_code: string | null;
  stale: boolean;
}

export interface NodeStatus {
  node_id: string;
  status: Status;
  monitors: MonitorSummary[];
}

export interface Snapshot {
  map: MapRecord;
  nodes: NodeRecord[];
  links: LinkRecord[];
  monitors: MonitorRecord[];
  statuses: NodeStatus[];
}

export interface NodePayload {
  name: string;
  kind: NodeKind;
  icon_id: string;
  ipv4: string | null;
  display_port: number | null;
  x: number;
  y: number;
}
