import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import type { NodeRecord, Status } from "../types";
import { FALLBACK_ICON, iconForId } from "../icons";

export interface TopologyNodeData {
  [key: string]: unknown;
  node: NodeRecord;
  status: Status;
  dimmed?: boolean;
  highlighted?: boolean;
}

export type TopologyFlowNode = Node<TopologyNodeData, "topology">;

export function TopologyNode({ data, selected }: NodeProps<TopologyFlowNode>) {
  const icon = iconForId(data.node.icon_id);
  const address = data.node.ipv4
    ? `${data.node.ipv4}${data.node.display_port ? `:${data.node.display_port}` : ""}`
    : "No address";

  return (
    <div
      className={`topology-node status-${data.status}${selected ? " is-selected" : ""}${data.dimmed ? " is-dimmed" : ""}${data.highlighted ? " is-search-highlighted" : ""}`}
      role="group"
      aria-label={`${data.node.name}, ${address}, status ${data.status}`}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-glyph" aria-hidden="true" title={icon.label}>
        <img
          className="node-glyph-image"
          src={icon.assetUrl}
          alt=""
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = FALLBACK_ICON.assetUrl;
          }}
        />
      </div>
      <div className="node-copy">
        <strong title={data.node.name}>{data.node.name}</strong>
        <span className="node-address">{address}</span>
      </div>
      <span className="node-status" title={`Status: ${data.status}`} aria-label={`Status: ${data.status}`} />
      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  );
}
