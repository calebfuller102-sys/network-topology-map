import type { Node, NodeProps } from "@xyflow/react";
import type { GroupRecord } from "../types";

export interface TopologyGroupData {
  [key: string]: unknown;
  group: GroupRecord;
}

export type TopologyFlowGroup = Node<TopologyGroupData, "topologyGroup">;

export function TopologyGroup({ data, selected }: NodeProps<TopologyFlowGroup>) {
  return (
    <div className={`topology-group${selected ? " is-selected" : ""}`}>
      <strong>{data.group.name}</strong>
      <span>{data.group.name ? "Drag nodes here" : "Group"}</span>
    </div>
  );
}
