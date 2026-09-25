import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type OnMove,
  type OnNodeDrag,
  type OnNodesChange,
  type Viewport,
} from "@xyflow/react";
import { api, ApiError } from "../api/client";
import { LinkInspector } from "../components/LinkInspector";
import { NodeInspector } from "../components/NodeInspector";
import { GroupInspector } from "../components/GroupInspector";
import { TopologyNode, type TopologyFlowNode } from "../components/TopologyNode";
import { TopologyGroup, type TopologyFlowGroup } from "../components/TopologyGroup";
import { TopologyLink, type TopologyFlowEdge } from "../components/TopologyLink";
import type {
  GroupPayload,
  GroupRecord,
  LinkHandle,
  LinkPayload,
  LinkRecord,
  ManualRunResponse,
  MonitorPayload,
  MonitorRecord,
  MonitorRunStatus,
  NodePayload,
  NodeRecord,
  Snapshot,
  Status,
} from "../types";
import { applyNodePositionChanges, completedNodePositionChanges, draftResetKey } from "./editorState";
import { NodePositionPersistence } from "./nodePositionPersistence";
import { LiveSnapshotSync, type SnapshotLoadResult } from "./liveSnapshotSync";
import { SnapshotCoordinator } from "./snapshotCoordinator";
import { ViewportPersistence } from "./viewportPersistence";

type FlowNode = TopologyFlowNode | TopologyFlowGroup;

const nodeTypes = { topology: TopologyNode, topologyGroup: TopologyGroup };
const edgeTypes = { topologyLink: TopologyLink };
const NODE_WIDTH = 210;
const NODE_HEIGHT = 59;
const GROUP_PADDING = 16;
const GROUP_TITLE_HEIGHT = 38;

const statusLabel: Record<Status, string> = {
  unknown: "Unknown",
  online: "Online",
  degraded: "Degraded",
  offline: "Offline",
};

function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function matchesSearchQuery(node: NodeRecord, normalizedQuery: string): boolean {
  return !normalizedQuery || [
    node.name,
    node.kind,
    node.ipv4 ?? "",
    node.display_port?.toString() ?? "",
  ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

function toFlowNodes(snapshot: Snapshot, normalizedQuery: string, highlightedNodeId: string | null): FlowNode[] {
  const statusByNode = new Map(snapshot.statuses.map((status) => [status.node_id, status.status]));
  const groups: TopologyFlowGroup[] = snapshot.groups.map((group) => ({
    id: group.id,
    type: "topologyGroup",
    position: { x: group.x, y: group.y },
    zIndex: 0,
    style: { width: group.width, height: group.height },
    data: { group },
  }));
  const nodes: TopologyFlowNode[] = snapshot.nodes.map((node) => ({
    id: node.id,
    type: "topology",
    position: { x: node.x, y: node.y },
    zIndex: 2,
    data: {
      node,
      status: statusByNode.get(node.id) ?? "unknown",
      dimmed: Boolean(normalizedQuery) && !matchesSearchQuery(node, normalizedQuery),
      highlighted: Boolean(normalizedQuery) && node.id === highlightedNodeId,
    },
  }));
  return [...groups, ...nodes];
}

function nearestHandle(from: NodeRecord | undefined, to: NodeRecord | undefined, fallback: LinkHandle): LinkHandle {
  if (!from || !to) return fallback;
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  if (Math.abs(deltaX) / NODE_WIDTH >= Math.abs(deltaY) / NODE_HEIGHT) {
    return deltaX >= 0 ? "right" : "left";
  }
  return deltaY >= 0 ? "bottom" : "top";
}

function visibleHandle(handle: string | null, fallback: LinkHandle): LinkHandle {
  const side = handle?.split("-")[0];
  return side === "top" || side === "right" || side === "bottom" || side === "left" ? side : fallback;
}

function matchingLink(links: readonly LinkRecord[], sourceId: string, targetId: string, kind: LinkPayload["kind"]): LinkRecord | undefined {
  return links.find((link) => link.kind === kind && (
    (link.source_node_id === sourceId && link.target_node_id === targetId)
    || (link.source_node_id === targetId && link.target_node_id === sourceId)
  ));
}

function toFlowEdges(snapshot: Snapshot, selectedLinkId: string | null): TopologyFlowEdge[] {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const edges: TopologyFlowEdge[] = snapshot.links.map((link) => {
    const source = nodesById.get(link.source_node_id);
    const target = nodesById.get(link.target_node_id);
    return {
      id: link.id,
      source: link.source_node_id,
      target: link.target_node_id,
      sourceHandle: visibleHandle(link.source_handle, nearestHandle(source, target, "right")),
      targetHandle: visibleHandle(link.target_handle, nearestHandle(target, source, "left")),
      type: "topologyLink",
      zIndex: 1,
      data: { parallelOffset: 0 },
      style: {
        stroke: link.id === selectedLinkId ? "#79cde3" : "#405257",
        strokeWidth: link.id === selectedLinkId ? 2 : 1.2,
        strokeDasharray: link.kind === "virtual" ? "6 5" : undefined,
      },
      interactionWidth: 18,
    };
  });
  const attachmentCounts = new Map<string, number>();
  const attachmentKey = (edge: TopologyFlowEdge) => (
    `${edge.source}:${edge.sourceHandle}:${edge.target}:${edge.targetHandle}`
  );
  for (const edge of edges) {
    const key = attachmentKey(edge);
    attachmentCounts.set(key, (attachmentCounts.get(key) ?? 0) + 1);
  }
  return edges.map((edge, index) => ({
    ...edge,
    data: {
      parallelOffset: snapshot.links[index].kind === "virtual"
        && (attachmentCounts.get(attachmentKey(edge)) ?? 0) > 1 ? 28 : 0,
    },
  }));
}

function groupDropPosition(groups: readonly GroupRecord[], position: { x: number; y: number }) {
  const centerX = position.x + NODE_WIDTH / 2;
  const centerY = position.y + NODE_HEIGHT / 2;
  const group = groups.find((candidate) => (
    centerX >= candidate.x && centerX <= candidate.x + candidate.width
      && centerY >= candidate.y + GROUP_TITLE_HEIGHT && centerY <= candidate.y + candidate.height
  ));
  if (!group) {
    return { groupId: null, position };
  }
  return {
    groupId: group.id,
    position: {
      x: Math.min(Math.max(position.x, group.x + GROUP_PADDING), group.x + group.width - NODE_WIDTH - GROUP_PADDING),
      y: Math.min(Math.max(position.y, group.y + GROUP_TITLE_HEIGHT), group.y + group.height - NODE_HEIGHT - GROUP_PADDING),
    },
  };
}

function AppContent() {
  const { setCenter } = useReactFlow<FlowNode>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [addingNode, setAddingNode] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocusedNodeId, setSearchFocusedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nodeDraftRevision, setNodeDraftRevision] = useState(0);
  const [linkDraftRevision, setLinkDraftRevision] = useState(0);
  const [groupDraftRevision, setGroupDraftRevision] = useState(0);
  const nodePositionPersistence = useRef<NodePositionPersistence | null>(null);
  const viewportPersistence = useRef<ViewportPersistence | null>(null);
  const viewportMapId = useRef<string | null>(null);
  const snapshotCoordinator = useRef(new SnapshotCoordinator());
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissNotice = useCallback(() => {
    if (noticeTimer.current !== null) {
      clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
    setNotice(null);
  }, []);

  const showNotice = useCallback((message: string) => {
    if (noticeTimer.current !== null) {
      clearTimeout(noticeTimer.current);
    }
    setNotice(message);
    noticeTimer.current = setTimeout(() => {
      noticeTimer.current = null;
      setNotice(null);
    }, 3_000);
  }, []);

  const applySnapshot = useCallback((result: SnapshotLoadResult): boolean => {
    if (!snapshotCoordinator.current.shouldApply(result.snapshot, result.request)) {
      return false;
    }
    setSnapshot(result.snapshot);
    return true;
  }, []);

  const fetchSnapshot = useCallback(async (preferredMapId?: string): Promise<Snapshot> => {
    const maps = await api.listMaps();
    if (maps.length === 0) {
      throw new Error("No map is available. The API should create a Home map during startup.");
    }
    const selectedMap = maps.find((map) => map.id === preferredMapId) ?? maps[0];
    return api.getSnapshot(selectedMap.id);
  }, []);

  const requestSnapshot = useCallback(async (preferredMapId?: string): Promise<SnapshotLoadResult> => {
    const request = snapshotCoordinator.current.beginRequest();
    const nextSnapshot = await fetchSnapshot(preferredMapId);
    return { snapshot: nextSnapshot, request };
  }, [fetchSnapshot]);

  const loadSnapshot = useCallback(async (preferredMapId?: string, showLoading = true): Promise<Snapshot | null> => {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await requestSnapshot(preferredMapId);
      applySnapshot(result);
      return result.snapshot;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the topology map.");
      return null;
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [applySnapshot, requestSnapshot]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!snapshot) {
      return undefined;
    }
    const mapId = snapshot.map.id;
    const sync = new LiveSnapshotSync({
      eventUrl: api.eventsUrl,
      loadSnapshot: async () => {
        return requestSnapshot(mapId);
      },
      onSnapshot: (result) => {
        if (applySnapshot(result)) {
          setError(null);
        }
      },
      onConnectionChange: setLiveConnected,
      onError: (cause) => {
        setError(cause instanceof Error ? cause.message : "Live update recovery failed.");
      },
    });
    sync.start(snapshot);
    return () => sync.dispose();
  }, [applySnapshot, requestSnapshot, snapshot?.map.id]);

  useEffect(() => () => {
    viewportPersistence.current?.dispose();
    viewportPersistence.current = null;
    viewportMapId.current = null;
    if (noticeTimer.current !== null) {
      clearTimeout(noticeTimer.current);
    }
  }, []);

  useEffect(() => {
    const saveViewportOnPageExit = () => {
      const currentMapId = viewportMapId.current;
      if (!currentMapId) {
        return;
      }
      viewportPersistence.current?.flushForPageExit((viewport) =>
        api.patchViewport(currentMapId, viewport.x, viewport.y, viewport.zoom, true),
      );
    };
    window.addEventListener("pagehide", saveViewportOnPageExit);
    return () => window.removeEventListener("pagehide", saveViewportOnPageExit);
  }, []);

  const normalizedSearchQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery]);
  const searchResults = useMemo(
    () => (snapshot && normalizedSearchQuery
      ? snapshot.nodes.filter((node) => matchesSearchQuery(node, normalizedSearchQuery))
      : []),
    [normalizedSearchQuery, snapshot],
  );
  const flowNodes = useMemo(
    () => (snapshot ? toFlowNodes(snapshot, normalizedSearchQuery, searchFocusedNodeId) : []),
    [normalizedSearchQuery, searchFocusedNodeId, snapshot],
  );
  const flowEdges = useMemo(
    () => (snapshot ? toFlowEdges(snapshot, selectedLinkId) : []),
    [selectedLinkId, snapshot],
  );
  const selectedNode = useMemo(
    () => snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, snapshot],
  );
  const selectedLink = useMemo(
    () => snapshot?.links.find((link) => link.id === selectedLinkId) ?? null,
    [selectedLinkId, snapshot],
  );
  const selectedGroup = useMemo(
    () => snapshot?.groups.find((group) => group.id === selectedGroupId) ?? null,
    [selectedGroupId, snapshot],
  );
  const selectedMonitors = useMemo(
    () => selectedNode ? snapshot?.monitors.filter((monitor) => monitor.node_id === selectedNode.id) ?? [] : [],
    [selectedNode, snapshot?.monitors],
  );

  const defaultPosition = useMemo(() => {
    const count = snapshot?.nodes.length ?? 0;
    return { x: 120 + (count % 4) * 220, y: 120 + Math.floor(count / 4) * 150 };
  }, [snapshot?.nodes.length]);
  const defaultGroupPosition = useMemo(() => {
    const count = snapshot?.groups.length ?? 0;
    return { x: 90 + (count % 3) * 110, y: 90 + Math.floor(count / 3) * 90 };
  }, [snapshot?.groups.length]);

  const onNodesChange: OnNodesChange<FlowNode> = useCallback((changes) => {
    // React Flow already owns the transient drag state. Writing every pointer
    // frame through the API-backed snapshot rebuilds the complete node list and
    // visibly fights its own drag renderer. Only commit the final coordinate
    // from onNodeDragStop below.
    const positionChanges = completedNodePositionChanges(changes);
    if (positionChanges.length === 0) {
      return;
    }

    // React Flow owns selection and dimension changes. Only actual canvas
    // positions belong in the API-backed snapshot.
    setSnapshot((current) => {
      if (!current) return current;
      const nodes = applyNodePositionChanges(current.nodes, positionChanges);
      if (nodes === current.nodes) {
        return current;
      }
      return {
        ...current,
        nodes,
      };
    });
  }, []);

  const persistPosition: OnNodeDrag<FlowNode> = useCallback((_event, node) => {
    if (node.type === "topologyGroup") {
      const group = node.data.group;
      if (!group) return;
      setError(null);
      void api.patchGroup(group.id, { x: node.position.x, y: node.position.y })
        .then(() => loadSnapshot())
        .then(() => showNotice("Group moved"))
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to save group position."));
      return;
    }
    setError(null);
    const dropped = snapshot ? groupDropPosition(snapshot.groups, node.position) : { groupId: null, position: node.position };
    setSnapshot((current) => {
      if (!current) return current;
      const nodes = applyNodePositionChanges(current.nodes, [{
        id: node.id,
        type: "position",
        position: dropped.position,
        dragging: false,
      }]);
      const membershipChanged = current.nodes.some((item) => item.id === node.id && item.group_id !== dropped.groupId);
      return nodes === current.nodes && !membershipChanged ? current : {
        ...current,
        nodes: nodes.map((item) => item.id === node.id ? { ...item, group_id: dropped.groupId } : item),
      };
    });
    if (!nodePositionPersistence.current) {
      nodePositionPersistence.current = new NodePositionPersistence(
        (nodeId, position) => api.patchNodePosition(nodeId, position.x, position.y, position.groupId),
        (cause) => {
          setError(cause instanceof Error ? cause.message : "Unable to save node position.");
          void loadSnapshot();
        },
        () => showNotice("Position saved"),
      );
    }
    nodePositionPersistence.current.schedule(node.id, { ...dropped.position, groupId: dropped.groupId });
  }, [loadSnapshot, showNotice, snapshot]);

  const queueViewportPersistence = useCallback((mapId: string, viewport: Viewport) => {
    if (viewportMapId.current !== mapId) {
      viewportPersistence.current?.dispose();
      viewportMapId.current = mapId;
      viewportPersistence.current = new ViewportPersistence(
        (nextViewport) => api.patchViewport(mapId, nextViewport.x, nextViewport.y, nextViewport.zoom),
        (cause) => setError(cause instanceof Error ? cause.message : "Unable to save viewport."),
      );
    }
    const persistence = viewportPersistence.current;
    if (persistence) {
      persistence.schedule(viewport);
    }
  }, []);

  const mapId = snapshot?.map.id;
  const persistViewport: OnMove = useCallback((_event, viewport: Viewport) => {
    if (!mapId) return;
    queueViewportPersistence(mapId, viewport);
  }, [mapId, queueViewportPersistence]);

  const selectSearchResult = useCallback((node: NodeRecord) => {
    setSelectedNodeId(node.id);
    setSelectedLinkId(null);
    setAddingNode(false);
    setAddingLink(false);
    setSearchFocusedNodeId(node.id);
    void setCenter(node.x + 105, node.y + 30, { duration: 180 });
  }, [setCenter]);

  const beginAddingNode = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedLinkId(null);
    setSelectedGroupId(null);
    setAddingLink(false);
    setAddingGroup(false);
    setAddingNode(true);
    setNodeDraftRevision((revision) => revision + 1);
  }, []);

  const beginAddingLink = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedLinkId(null);
    setSelectedGroupId(null);
    setAddingNode(false);
    setAddingGroup(false);
    setAddingLink(true);
    setLinkDraftRevision((revision) => revision + 1);
  }, []);

  const selectSavedLink = useCallback((linkId: string) => {
    setSelectedLinkId(linkId);
    setSelectedNodeId(null);
    setSelectedGroupId(null);
    setAddingNode(false);
    setAddingLink(false);
    setAddingGroup(false);
  }, []);

  const beginAddingGroup = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedLinkId(null);
    setSelectedGroupId(null);
    setAddingNode(false);
    setAddingLink(false);
    setAddingGroup(true);
    setGroupDraftRevision((revision) => revision + 1);
  }, []);

  const saveNode = useCallback(async (payload: NodePayload) => {
    if (!snapshot) return;
    const editingExistingNode = Boolean(selectedNode);
    setSaving(true);
    setError(null);
    try {
      const saved = selectedNode
        ? await api.patchNode(selectedNode.id, payload)
        : await api.createNode(snapshot.map.id, payload);
      await loadSnapshot();
      setSelectedNodeId(saved.id);
      setSelectedLinkId(null);
      setAddingNode(false);
      setAddingLink(false);
      setNodeDraftRevision((revision) => revision + 1);
      showNotice(editingExistingNode ? "Node saved" : "Node created");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save node.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedNode, showNotice, snapshot]);

  const saveGroup = useCallback(async (payload: GroupPayload) => {
    if (!snapshot) return;
    const editingExistingGroup = Boolean(selectedGroup);
    setSaving(true);
    setError(null);
    try {
      const saved = selectedGroup
        ? await api.patchGroup(selectedGroup.id, payload)
        : await api.createGroup(snapshot.map.id, payload);
      await loadSnapshot();
      setSelectedGroupId(saved.id);
      setSelectedNodeId(null);
      setSelectedLinkId(null);
      setAddingGroup(false);
      setGroupDraftRevision((revision) => revision + 1);
      showNotice(editingExistingGroup ? "Group saved" : "Group created");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save group.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedGroup, showNotice, snapshot]);

  const deleteSelectedGroup = useCallback(async () => {
    if (!selectedGroup) return;
    if (!window.confirm(`Delete ${selectedGroup.name}? Nodes will remain on the map.`)) return;
    setSaving(true);
    try {
      await api.deleteGroup(selectedGroup.id);
      setSelectedGroupId(null);
      await loadSnapshot();
      showNotice("Group deleted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete group.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedGroup, showNotice]);

  const refreshMonitorSnapshot = useCallback(async (): Promise<void> => {
    const currentMapId = snapshot?.map.id;
    if (!currentMapId) {
      throw new Error("No map is available for monitor diagnostics.");
    }
    const nextSnapshot = await loadSnapshot(currentMapId, false);
    if (!nextSnapshot) {
      throw new Error("Unable to refresh monitor diagnostics.");
    }
  }, [loadSnapshot, snapshot?.map.id]);

  const createMonitor = useCallback(async (nodeId: string, payload: MonitorPayload): Promise<MonitorRecord> => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.createMonitor(nodeId, payload);
      await refreshMonitorSnapshot();
      showNotice("Check added");
      return saved;
    } finally {
      setSaving(false);
    }
  }, [refreshMonitorSnapshot, showNotice]);

  const updateMonitor = useCallback(async (monitorId: string, payload: MonitorPayload): Promise<MonitorRecord> => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.patchMonitor(monitorId, payload);
      await refreshMonitorSnapshot();
      showNotice("Check saved");
      return saved;
    } finally {
      setSaving(false);
    }
  }, [refreshMonitorSnapshot, showNotice]);

  const deleteMonitor = useCallback(async (monitorId: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.deleteMonitor(monitorId);
      await refreshMonitorSnapshot();
      showNotice("Check deleted");
    } finally {
      setSaving(false);
    }
  }, [refreshMonitorSnapshot, showNotice]);

  const runMonitor = useCallback((monitorId: string): Promise<ManualRunResponse> => api.runMonitor(monitorId), []);
  const getMonitorRun = useCallback(
    (monitorId: string, runId: string): Promise<MonitorRunStatus> => api.getMonitorRun(monitorId, runId),
    [],
  );

  const deleteSelectedNode = useCallback(async () => {
    if (!selectedNode) return;
    if (!window.confirm(`Delete ${selectedNode.name}? Connected links and checks will also be removed.`)) return;
    setSaving(true);
    try {
      await api.deleteNode(selectedNode.id);
      setSelectedNodeId(null);
      setSelectedLinkId(null);
      await loadSnapshot();
      showNotice("Node deleted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete node.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedNode, showNotice]);

  const saveLink = useCallback(async (payload: LinkPayload) => {
    if (!snapshot) return;
    const editingExistingLink = Boolean(selectedLink);
    setSaving(true);
    setError(null);
    try {
      const saved = selectedLink
        ? await api.patchLink(selectedLink.id, payload.kind)
        : await api.createLink(snapshot.map.id, payload);
      const refreshed = await loadSnapshot(snapshot.map.id, false);
      setSelectedLinkId(saved.id);
      setSelectedNodeId(null);
      setAddingLink(false);
      setLinkDraftRevision((revision) => revision + 1);
      if (!refreshed) {
        setError("The link was saved, but the map could not refresh. Reload to see or edit it.");
        return;
      }
      showNotice(editingExistingLink ? "Link saved" : "Link created");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save link.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedLink, showNotice, snapshot]);

  const deleteSelectedLink = useCallback(async () => {
    if (!selectedLink) return;
    if (!window.confirm("Delete this link?")) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteLink(selectedLink.id);
      setSelectedLinkId(null);
      await loadSnapshot();
      showNotice("Link deleted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete link.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedLink, showNotice]);

  const connectNodes = useCallback((connection: Connection) => {
    if (!snapshot || !connection.source || !connection.target || connection.source === connection.target) {
      return;
    }
    const existing = matchingLink(snapshot.links, connection.source, connection.target, "local");
    if (existing) {
      selectSavedLink(existing.id);
      showNotice("This link already exists — selected it for editing");
      return;
    }
    setSaving(true);
    setError(null);
    void api.createLink(snapshot.map.id, {
        source_node_id: connection.source,
        target_node_id: connection.target,
        kind: "local",
        source_handle: connection.sourceHandle as LinkPayload["source_handle"],
        target_handle: connection.targetHandle as LinkPayload["target_handle"],
      })
      .then(async (saved) => {
        const refreshed = await loadSnapshot(snapshot.map.id, false);
        selectSavedLink(saved.id);
        if (!refreshed) {
          setError("The link was saved, but the map could not refresh. Reload to see or edit it.");
          return;
        }
        showNotice("Link created");
      })
      .catch(async (cause: unknown) => {
        if (cause instanceof ApiError && cause.code === "duplicate_link") {
          const refreshed = await loadSnapshot(snapshot.map.id, false);
          const duplicate = refreshed && matchingLink(refreshed.links, connection.source!, connection.target!, "local");
          if (duplicate) {
            selectSavedLink(duplicate.id);
            showNotice("This link already exists — selected it for editing");
            return;
          }
        }
        setError(cause instanceof Error ? cause.message : "Unable to create link.");
      })
      .finally(() => setSaving(false));
  }, [loadSnapshot, selectSavedLink, showNotice, snapshot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" || saving) {
        return;
      }
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      if (selectedNodeId) {
        event.preventDefault();
        void deleteSelectedNode();
      } else if (selectedLinkId) {
        event.preventDefault();
        void deleteSelectedLink();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelectedLink, deleteSelectedNode, saving, selectedLinkId, selectedNodeId]);

  if (loading) {
    return <div className="loading-screen">Loading topology map…</div>;
  }

  return (
    <main className="app-shell" aria-label="Network topology map">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">⌁</span>
          <div>
            <span className="eyebrow">Topology map</span>
            <h1>{snapshot?.map.name ?? "Network"}</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`connection-state${liveConnected ? "" : " is-disconnected"}`}>
            <span className="connection-dot" />
            {liveConnected ? "Live updates connected" : "Live updates disconnected — retrying"}
          </span>
          <button className="button muted" type="button" onClick={() => void loadSnapshot()}>
            Reload
          </button>
          <button
            className="button muted"
            type="button"
            onClick={beginAddingLink}
            disabled={!snapshot || snapshot.nodes.length < 2}
            title={snapshot && snapshot.nodes.length < 2 ? "Add at least two nodes first" : undefined}
          >
            Add link
          </button>
          <button className="button muted" type="button" onClick={beginAddingGroup}>Add group</button>
          <button
            className="button primary"
            type="button"
            onClick={beginAddingNode}
          >
            Add node
          </button>
        </div>
      </header>
      {error ? (
        <div className="message error" role="alert" aria-live="assertive">
          <span>{error}</span>
          <button type="button" onClick={() => void loadSnapshot()}>Retry</button>
        </div>
      ) : null}
      {notice ? (
        <button type="button" className="message notice" onClick={dismissNotice} aria-label="Dismiss notification" aria-live="polite">
          {notice}
        </button>
      ) : null}
      <section
        className={`workspace${snapshot?.nodes.length === 0 ? " workspace-empty" : ""}`}
        aria-label="Topology workspace"
      >
        <div className="canvas-panel">
          <div className="canvas-toolbar">
            <span>{snapshot?.nodes.length ?? 0} nodes · {snapshot?.links.length ?? 0} links</span>
            <div className="search-field">
              <label className="sr-only" htmlFor="node-search">Search nodes</label>
              <input
                id="node-search"
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchFocusedNodeId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && searchResults[0]) {
                    event.preventDefault();
                    selectSearchResult(searchResults[0]);
                  }
                }}
                placeholder="Search nodes"
                aria-controls={searchQuery.trim() ? "node-search-results" : undefined}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchFocusedNodeId(null);
                  }}
                  aria-label="Clear node search"
                >
                  ×
                </button>
              ) : null}
              {searchQuery.trim() && searchResults.length > 0 ? (
                <div className="search-results" id="node-search-results" role="listbox" aria-label="Matching nodes">
                  {searchResults.slice(0, 6).map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className="search-result"
                      role="option"
                      aria-selected={node.id === searchFocusedNodeId}
                      onClick={() => selectSearchResult(node)}
                    >
                      <strong>{node.name}</strong>
                      <span>{node.ipv4 ?? "No address"}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="legend" aria-label="Status legend">
              {(Object.keys(statusLabel) as Status[]).map((status) => (
                <span key={status}><i className={`legend-dot status-${status}`} />{statusLabel[status]}</span>
              ))}
            </div>
          </div>
          <div className="flow-wrap">
            <ReactFlow<FlowNode>
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(_event, node) => {
                if (node.type === "topologyGroup") {
                  setSelectedGroupId(node.id);
                  setSelectedNodeId(null);
                  setSelectedLinkId(null);
                  setAddingGroup(false);
                } else {
                  setSelectedNodeId(node.id);
                  setSelectedGroupId(null);
                  setAddingNode(false);
                  setSelectedLinkId(null);
                  setAddingLink(false);
                  setAddingGroup(false);
                }
              }}
              onEdgeClick={(_event, edge) => {
                selectSavedLink(edge.id);
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedLinkId(null);
                setSelectedGroupId(null);
                setAddingNode(false);
                setAddingLink(false);
                setAddingGroup(false);
              }}
              onNodeDragStop={persistPosition}
              onConnect={connectNodes}
              connectionMode={ConnectionMode.Loose}
              connectionLineType={ConnectionLineType.Bezier}
              onMoveEnd={persistViewport}
              defaultViewport={snapshot ? {
                x: snapshot.map.viewport_x,
                y: snapshot.map.viewport_y,
                zoom: snapshot.map.viewport_zoom,
              } : undefined}
              nodesConnectable
              elevateNodesOnSelect={false}
              elevateEdgesOnSelect={false}
              deleteKeyCode={null}
              fitView={flowNodes.length === 0}
              minZoom={0.2}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#263336" gap={28} size={1} />
              <Controls showInteractive={false} />
              {snapshot?.nodes.length === 0 ? (
                <div className="empty-map" role="status">
                  <span className="empty-glyph">+</span>
                  <h2>Start your map</h2>
                  <p>Add the first node, then drag it into position.</p>
                  <button
                    className="button primary nopan"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      beginAddingNode();
                    }}
                  >
                    Add first node
                  </button>
                </div>
              ) : null}
              {searchQuery.trim() && flowNodes.every((node) => node.data.dimmed) ? (
                <div className="search-empty" role="status">No matching nodes</div>
              ) : null}
            </ReactFlow>
          </div>
        </div>
        {selectedLink || addingLink ? (
          <LinkInspector
            link={selectedLink}
            links={snapshot?.links ?? []}
            nodes={snapshot?.nodes ?? []}
            resetKey={draftResetKey(selectedLink?.id ?? null, linkDraftRevision)}
            saving={saving}
            onCancel={() => {
              setSelectedLinkId(null);
              setAddingLink(false);
            }}
            onSave={saveLink}
            onDelete={deleteSelectedLink}
            onSelectExisting={selectSavedLink}
          />
        ) : selectedNode || addingNode ? (
          <NodeInspector
            node={selectedNode}
            defaultPosition={defaultPosition}
            resetKey={draftResetKey(selectedNode?.id ?? null, nodeDraftRevision)}
            saving={saving}
            onCancel={() => {
              setSelectedNodeId(null);
              setAddingNode(false);
            }}
            onSave={saveNode}
            onDelete={deleteSelectedNode}
            monitors={selectedMonitors}
            liveConnected={liveConnected}
            onCreateMonitor={createMonitor}
            onUpdateMonitor={updateMonitor}
            onDeleteMonitor={deleteMonitor}
            onRunMonitor={runMonitor}
            onGetMonitorRun={getMonitorRun}
            onRefreshMonitors={refreshMonitorSnapshot}
          />
        ) : selectedGroup || addingGroup ? (
          <GroupInspector
            group={selectedGroup}
            defaultPosition={defaultGroupPosition}
            resetKey={draftResetKey(selectedGroup?.id ?? null, groupDraftRevision)}
            saving={saving}
            onCancel={() => {
              setSelectedGroupId(null);
              setAddingGroup(false);
            }}
            onSave={saveGroup}
            onDelete={deleteSelectedGroup}
          />
        ) : null}
      </section>
    </main>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  );
}
