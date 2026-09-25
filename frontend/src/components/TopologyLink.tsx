import { BaseEdge, getBezierPath, Position } from "@xyflow/react";
import type { Edge, EdgeProps } from "@xyflow/react";

interface TopologyLinkData extends Record<string, unknown> {
  parallelOffset: number;
}

export type TopologyFlowEdge = Edge<TopologyLinkData, "topologyLink">;

function outward(position: Position): { x: number; y: number } {
  switch (position) {
    case Position.Left: return { x: -1, y: 0 };
    case Position.Right: return { x: 1, y: 0 };
    case Position.Top: return { x: 0, y: -1 };
    case Position.Bottom: return { x: 0, y: 1 };
  }
}

export function TopologyLink({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style, interactionWidth,
}: EdgeProps<TopologyFlowEdge>) {
  const offset = data?.parallelOffset ?? 0;
  let [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });

  if (offset) {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const distance = Math.hypot(dx, dy);
    const normalX = distance ? -dy / distance : 0;
    const normalY = distance ? dx / distance : -1;
    const reach = Math.max(24, Math.min(90, distance * 0.3));
    const sourceOut = outward(sourcePosition);
    const targetOut = outward(targetPosition);
    const sourceControlX = sourceX + sourceOut.x * reach + normalX * offset;
    const sourceControlY = sourceY + sourceOut.y * reach + normalY * offset;
    const targetControlX = targetX + targetOut.x * reach + normalX * offset;
    const targetControlY = targetY + targetOut.y * reach + normalY * offset;
    path = `M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`;
  }

  return <BaseEdge id={id} path={path} style={style} interactionWidth={interactionWidth} />;
}
