import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type OnMove,
  type OnNodeDrag,
  type OnNodesChange,
  type Viewport,
} from "@xyflow/react";
import { api } from "../api/client";
import { LinkInspector } from "../components/LinkInspector";
import { NodeInspector } from "../components/NodeInspector";
import { TopologyNode, type TopologyFlowNode } from "../components/TopologyNode";
import type { LinkPayload, NodePayload, NodeRecord, Snapshot, Status } from "../types";
import { applyNodePositionChanges, draftResetKey } from "./editorState";
import { NodePositionPersistence } from "./nodePositionPersistence";
import { LiveSnapshotSync } from "./liveSnapshotSync";
import { ViewportPersistence } from "./viewportPersistence";

type FlowNode = TopologyFlowNode;

const nodeTypes = { topology: TopologyNode };

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
  return snapshot.nodes.map((node) => ({
    id: node.id,
    type: "topology",
    position: { x: node.x, y: node.y },
    data: {
      node,
      status: statusByNode.get(node.id) ?? "unknown",
      dimmed: Boolean(normalizedQuery) && !matchesSearchQuery(node, normalizedQuery),
      highlighted: Boolean(normalizedQuery) && node.id === highlightedNodeId,
    },
  }));
}

function toFlowEdges(snapshot: Snapshot, selectedLinkId: string | null): Edge[] {
  return snapshot.links.map((link) => ({
    id: link.id,
    source: link.source_node_id,
    target: link.target_node_id,
    type: "straight",
    style: {
      stroke: link.id === selectedLinkId ? "#79cde3" : "#405257",
      strokeWidth: link.id === selectedLinkId ? 2 : 1.2,
      strokeDasharray: link.kind === "virtual" ? "6 5" : undefined,
    },
    interactionWidth: 18,
  }));
}

function AppContent() {
  const { setCenter } = useReactFlow<FlowNode>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [addingNode, setAddingNode] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocusedNodeId, setSearchFocusedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nodeDraftRevision, setNodeDraftRevision] = useState(0);
  const [linkDraftRevision, setLinkDraftRevision] = useState(0);
  const nodePositionPersistence = useRef<NodePositionPersistence | null>(null);
  const viewportPersistence = useRef<ViewportPersistence | null>(null);
  const viewportMapId = useRef<string | null>(null);

  const loadSnapshot = useCallback(async (preferredMapId?: string, showLoading = true): Promise<Snapshot | null> => {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const maps = await api.listMaps();
      if (maps.length === 0) {
        throw new Error("No map is available. The API should create a Home map during startup.");
      }
      const selectedMap = maps.find((map) => map.id === preferredMapId) ?? maps[0];
      const nextSnapshot = await api.getSnapshot(selectedMap.id);
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the topology map.");
      return null;
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

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
        const nextSnapshot = await loadSnapshot(mapId, false);
        if (!nextSnapshot) {
          throw new Error("Unable to refresh the topology map.");
        }
        return nextSnapshot;
      },
      onSnapshot: (nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setError(null);
      },
      onConnectionChange: setLiveConnected,
      onError: (cause) => {
        setError(cause instanceof Error ? cause.message : "Live update recovery failed.");
      },
    });
    sync.start(snapshot);
    return () => sync.dispose();
  }, [loadSnapshot, snapshot?.map.id]);

  useEffect(() => () => {
    viewportPersistence.current?.dispose();
    viewportPersistence.current = null;
    viewportMapId.current = null;
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

  const defaultPosition = useMemo(() => {
    const count = snapshot?.nodes.length ?? 0;
    return { x: 120 + (count % 4) * 220, y: 120 + Math.floor(count / 4) * 150 };
  }, [snapshot?.nodes.length]);

  const onNodesChange: OnNodesChange<FlowNode> = useCallback((changes) => {
    const positionChanges = changes.filter((change) => change.type === "position");
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
    setError(null);
    if (!nodePositionPersistence.current) {
      nodePositionPersistence.current = new NodePositionPersistence(
        (nodeId, position) => api.patchNodePosition(nodeId, position.x, position.y),
        (cause) => {
          setError(cause instanceof Error ? cause.message : "Unable to save node position.");
          void loadSnapshot();
        },
        () => setNotice("Position saved"),
      );
    }
    nodePositionPersistence.current.schedule(node.id, node.position);
  }, [loadSnapshot]);

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
    setAddingLink(false);
    setAddingNode(true);
    setNodeDraftRevision((revision) => revision + 1);
  }, []);

  const beginAddingLink = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedLinkId(null);
    setAddingNode(false);
    setAddingLink(true);
    setLinkDraftRevision((revision) => revision + 1);
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
      setNotice(editingExistingNode ? "Node saved" : "Node created");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save node.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedNode, snapshot]);

  const deleteSelectedNode = useCallback(async () => {
    if (!selectedNode) return;
    if (!window.confirm(`Delete ${selectedNode.name}? Connected links and checks will also be removed.`)) return;
    setSaving(true);
    try {
      await api.deleteNode(selectedNode.id);
      setSelectedNodeId(null);
      setSelectedLinkId(null);
      await loadSnapshot();
      setNotice("Node deleted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete node.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedNode]);

  const saveLink = useCallback(async (payload: LinkPayload) => {
    if (!snapshot) return;
    const editingExistingLink = Boolean(selectedLink);
    setSaving(true);
    setError(null);
    try {
      const saved = selectedLink
        ? await api.patchLink(selectedLink.id, payload.kind)
        : await api.createLink(snapshot.map.id, payload);
      await loadSnapshot();
      setSelectedLinkId(saved.id);
      setSelectedNodeId(null);
      setAddingLink(false);
      setLinkDraftRevision((revision) => revision + 1);
      setNotice(editingExistingLink ? "Link saved" : "Link created");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save link.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedLink, snapshot]);

  const deleteSelectedLink = useCallback(async () => {
    if (!selectedLink) return;
    if (!window.confirm("Delete this link?")) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteLink(selectedLink.id);
      setSelectedLinkId(null);
      await loadSnapshot();
      setNotice("Link deleted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete link.");
    } finally {
      setSaving(false);
    }
  }, [loadSnapshot, selectedLink]);

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
        <button type="button" className="message notice" onClick={() => setNotice(null)} aria-label="Dismiss notification" aria-live="polite">
          {notice}
        </button>
      ) : null}
      <section className="workspace" aria-label="Topology workspace">
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
              onNodesChange={onNodesChange}
              onNodeClick={(_event, node) => {
                setSelectedNodeId(node.id);
                setAddingNode(false);
                setSelectedLinkId(null);
                setAddingLink(false);
              }}
              onEdgeClick={(_event, edge) => {
                setSelectedLinkId(edge.id);
                setSelectedNodeId(null);
                setAddingNode(false);
                setAddingLink(false);
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedLinkId(null);
                setAddingNode(false);
                setAddingLink(false);
              }}
              onNodeDragStop={persistPosition}
              onMoveEnd={persistViewport}
              defaultViewport={snapshot ? {
                x: snapshot.map.viewport_x,
                y: snapshot.map.viewport_y,
                zoom: snapshot.map.viewport_zoom,
              } : undefined}
              nodesConnectable={false}
              deleteKeyCode={null}
              fitView={flowNodes.length === 0}
              minZoom={0.2}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#263336" gap={28} size={1} />
              <Controls showInteractive={false} />
              <MiniMap nodeColor="#405257" maskColor="rgba(10, 14, 15, 0.7)" />
              {snapshot?.nodes.length === 0 ? (
                <div className="empty-map" role="status">
                  <span className="empty-glyph">+</span>
                  <h2>Start your map</h2>
                  <p>Add the first node, then drag it into position.</p>
                  <button className="button primary" type="button" onClick={beginAddingNode}>
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
            nodes={snapshot?.nodes ?? []}
            resetKey={draftResetKey(selectedLink?.id ?? null, linkDraftRevision)}
            saving={saving}
            onCancel={() => {
              setSelectedLinkId(null);
              setAddingLink(false);
            }}
            onSave={saveLink}
            onDelete={deleteSelectedLink}
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
          />
        ) : (
          <aside className="inspector inspector-empty">
            <span className="eyebrow">Inspector</span>
            <h2>Select a node or link</h2>
            <p>Choose a node or link on the map to edit its details, or add one from the toolbar.</p>
          </aside>
        )}
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
