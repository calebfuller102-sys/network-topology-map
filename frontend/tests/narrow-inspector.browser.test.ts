import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { LinkPayload, LinkRecord } from "../src/types";

const rootDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distributionDirectory = resolve(rootDirectory, "dist");
const baseUrl = "http://127.0.0.1:4173";
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

let server: Server;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const requestedPath = new URL(request.url ?? "/", baseUrl).pathname;
    const candidate = resolve(distributionDirectory, `.${requestedPath}`);
    const filePath = candidate === distributionDirectory || candidate.startsWith(`${distributionDirectory}${sep}`)
      ? candidate
      : resolve(distributionDirectory, "index.html");
    try {
      const contents = await readFile(filePath);
      response.writeHead(200, { "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
      response.end(contents);
    } catch {
      const index = await readFile(resolve(distributionDirectory, "index.html"));
      response.writeHead(200, { "content-type": contentTypes[".html"] });
      response.end(index);
    }
  });
  await new Promise<void>((ready, reject) => {
    server.once("error", reject);
    server.listen(4173, "127.0.0.1", () => {
      server.off("error", reject);
      ready();
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) => {
    server.close((error) => (error ? reject(error) : done()));
  });
});

const map = {
  id: "map-a",
  name: "Home",
  viewport_x: 0,
  viewport_y: 0,
  viewport_zoom: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const snapshot = {
  revision: 1,
  map,
  nodes: [
    {
      id: "node-a",
      map_id: map.id,
      name: "Audit Router",
      kind: "device",
      icon_id: "mdi-router",
      hyperlink: "http://127.0.0.1:4173/linked-page",
      ipv4: null,
      display_port: null,
      x: 80,
      y: 80,
      created_at: map.created_at,
      updated_at: map.updated_at,
    },
    {
      id: "node-b",
      map_id: map.id,
      name: "Audit Service",
      kind: "service",
      icon_id: "mdi-server",
      hyperlink: null,
      ipv4: null,
      display_port: null,
      x: 340,
      y: 80,
      created_at: map.created_at,
      updated_at: map.updated_at,
    },
  ],
  groups: [],
  links: [],
  monitors: [],
  statuses: [
    { node_id: "node-a", status: "unknown", monitors: [] },
    { node_id: "node-b", status: "unknown", monitors: [] },
  ],
};

test("closing an inspector at 390px restores a populated map canvas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/maps", async (route) => {
    await route.fulfill({ json: [map] });
  });
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => {
    await route.fulfill({ json: snapshot });
  });
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });

  await page.goto(baseUrl);
  await expect(page.locator(".topology-node")).toHaveCount(2);
  await expect(page.locator(".inspector-empty")).toHaveCount(0);

  await page.getByText("Audit Router", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Close inspector" })).toBeVisible();
  await page.getByRole("button", { name: "Close inspector" }).click();

  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect(page.locator(".canvas-panel")).toHaveCSS("width", "390px");
  await expect(page.locator(".topology-node")).toHaveCount(2);
});

test("a node icon opens its saved local hyperlink", async ({ page, context }) => {
  await page.route("**/api/v1/maps", async (route) => {
    await route.fulfill({ json: [map] });
  });
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => {
    await route.fulfill({ json: snapshot });
  });
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });

  await page.goto(baseUrl);
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Open Audit Router hyperlink" }).click();
  await expect((await popup).url()).toBe("http://127.0.0.1:4173/linked-page");
});

test("a saved position notice appears below the toolbar and clears after three seconds", async ({ page }) => {
  await page.route("**/api/v1/maps", async (route) => {
    await route.fulfill({ json: [map] });
  });
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => {
    await route.fulfill({ json: snapshot });
  });
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });
  await page.route("**/api/v1/nodes/node-a/position", async (route) => {
    await route.fulfill({ json: { ...snapshot.nodes[0], x: 140, y: 120 } });
  });

  await page.goto(baseUrl);
  const node = page.locator(".topology-node").first();
  const box = await node.boundingBox();
  if (!box) {
    throw new Error("Topology node did not render for drag test.");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();

  const notice = page.locator(".message.notice");
  await expect(notice).toHaveText("Position saved");
  await expect(notice).toHaveCSS("top", "118px");
  await expect(notice).toHaveCount(0, { timeout: 4_000 });
});

test("a non-bundled mdi icon uses the approved remote image and shows its editor guidance", async ({ page }) => {
  const remoteSnapshot = {
    ...snapshot,
    nodes: snapshot.nodes.map((node, index) => (index === 0 ? { ...node, icon_id: "mdi-vpn" } : node)),
  };
  let iconRequested = false;
  await page.route("**/api/v1/maps", async (route) => {
    await route.fulfill({ json: [map] });
  });
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => {
    await route.fulfill({ json: remoteSnapshot });
  });
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });
  await page.route("https://api.iconify.design/mdi/vpn.svg?color=%2379cde3", async (route) => {
    iconRequested = true;
    await route.fulfill({ contentType: "image/svg+xml", body: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>" });
  });

  await page.goto(baseUrl);
  const image = page.locator(".topology-node").first().locator("img");
  await expect(image).toHaveAttribute("src", "https://api.iconify.design/mdi/vpn.svg?color=%2379cde3");
  await expect.poll(() => iconRequested).toBe(true);

  await page.getByText("Audit Router", { exact: true }).click();
  await expect(page.getByText("This Material Design icon will load from Iconify.")).toBeVisible();
});

test("named groups render behind their nodes and expose an inspector", async ({ page }) => {
  const groupedSnapshot = {
    ...snapshot,
    groups: [{
      id: "group-a", map_id: map.id, name: "Core services", x: 45, y: 45, width: 560, height: 240,
      created_at: map.created_at, updated_at: map.updated_at,
    }],
    links: [{
      id: "group-link", map_id: map.id, source_node_id: "node-a", target_node_id: "node-b", kind: "local",
      source_handle: "right", target_handle: "left", created_at: map.created_at,
    }],
  };
  await page.route("**/api/v1/maps", async (route) => route.fulfill({ json: [map] }));
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => route.fulfill({ json: groupedSnapshot }));
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });

  await page.goto(baseUrl);
  await expect(page.getByText("Core services", { exact: true })).toBeVisible();
  await expect(page.locator(".topology-group")).toHaveCount(1);
  const layers = await page.evaluate(() => ({
    group: Number(getComputedStyle(document.querySelector(".react-flow__node-topologyGroup")!).zIndex),
    edge: Number(getComputedStyle(document.querySelector(".react-flow__edge")!.parentElement!).zIndex),
    node: Number(getComputedStyle(document.querySelector(".react-flow__node-topology")!).zIndex),
  }));
  expect(layers.group).toBeLessThan(layers.edge);
  expect(layers.edge).toBeLessThan(layers.node);
  const edgeMidpoint = await page.locator(".react-flow__edge-path").evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Link path has no screen transform.");
    return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
  });
  await page.mouse.click(edgeMidpoint.x, edgeMidpoint.y);
  await expect(page.getByRole("button", { name: "Delete link" })).toBeVisible();
  await page.getByText("Core services", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Close group inspector" })).toBeVisible();
});

test("editing a group sends only its editable fields", async ({ page }) => {
  const group = {
    id: "group-a", map_id: map.id, name: "Core services", x: 45, y: 45, width: 560, height: 240,
    created_at: map.created_at, updated_at: map.updated_at,
  };
  const groupedSnapshot = { ...snapshot, groups: [group] };
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/maps", async (route) => route.fulfill({ json: [map] }));
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => route.fulfill({ json: groupedSnapshot }));
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });
  await page.route("**/api/v1/groups/group-a", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { ...group, ...submitted } });
  });

  await page.goto(baseUrl);
  await page.getByText("Core services", { exact: true }).click();
  await page.getByLabel("Width").fill("640");
  await page.getByRole("button", { name: "Save group" }).click();

  await expect.poll(() => submitted).toMatchObject({ name: "Core services", x: 45, y: 45, width: 640, height: 240 });
  expect(Object.keys(submitted ?? {}).sort()).toEqual(["height", "name", "width", "x", "y"]);
});

test("node cards provide one connection point on each side", async ({ page }) => {
  await page.route("**/api/v1/maps", async (route) => route.fulfill({ json: [map] }));
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });
  await page.goto(baseUrl);
  const firstNode = page.locator(".topology-node").first();
  await expect(firstNode.locator(".react-flow__handle")).toHaveCount(4);
  for (const side of ["top", "right", "bottom", "left"]) {
    await expect(firstNode.locator(`.react-flow__handle[data-handleid="${side}"]`)).toHaveCount(1);
  }
});

test("a dragged link stays curved and persists after reload", async ({ page }) => {
  const current = { ...structuredClone(snapshot), links: [] as LinkRecord[] };
  let submitted: LinkPayload | null = null;
  await page.route("**/api/v1/maps", async (route) => route.fulfill({ json: [map] }));
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => route.fulfill({ json: current }));
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });
  await page.route("**/api/v1/maps/map-a/links", async (route) => {
    submitted = route.request().postDataJSON() as LinkPayload;
    const link: LinkRecord = {
      ...submitted,
      id: "link-created", map_id: map.id,
      source_handle: submitted.source_handle ?? null,
      target_handle: submitted.target_handle ?? null,
      created_at: map.created_at,
    };
    current.links.push(link);
    await route.fulfill({ status: 201, json: link });
  });

  await page.goto(baseUrl);
  const source = page.locator('.topology-node').first().locator('[data-handleid="right"]');
  const target = page.locator('.topology-node').nth(1).locator('[data-handleid="left"]');
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Connection handles did not render.");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => submitted).toMatchObject({ source_handle: "right", target_handle: "left" });
  await expect(page.locator(".react-flow__edge-path")).toHaveAttribute("d", /C/);
  await page.reload();
  await expect(page.locator(".react-flow__edge-path")).toHaveAttribute("d", /C/);
});

test("an inspector-created link is visible after reload and duplicate feedback opens it", async ({ page }) => {
  const current = { ...structuredClone(snapshot), links: [] as LinkRecord[] };
  let creations = 0;
  await page.route("**/api/v1/maps", async (route) => route.fulfill({ json: [map] }));
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => route.fulfill({ json: current }));
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });
  await page.route("**/api/v1/maps/map-a/links", async (route) => {
    creations += 1;
    const payload = route.request().postDataJSON() as LinkPayload;
    const link: LinkRecord = {
      ...payload,
      id: "link-inspector", map_id: map.id,
      source_handle: payload.source_handle ?? null,
      target_handle: payload.target_handle ?? null,
      created_at: map.created_at,
    };
    current.links.push(link);
    await route.fulfill({ status: 201, json: link });
  });

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "Add link" }).click();
  await page.getByRole("button", { name: "Save link" }).click();
  await expect(page.locator(".react-flow__edge-path")).toHaveAttribute("d", /C/);
  await page.reload();
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(1);
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page.getByText("This local link already exists.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save link" })).toBeDisabled();
  await page.getByRole("button", { name: "Open it" }).click();
  await expect(page.getByRole("button", { name: "Delete link" })).toBeVisible();
  expect(creations).toBe(1);
});

test("legacy and handle-free saved links remain selectable and deletable", async ({ page }) => {
  const current = {
    ...snapshot,
    links: [
      {
        id: "link-legacy", map_id: map.id, source_node_id: "node-a", target_node_id: "node-b", kind: "local",
        source_handle: "right-source", target_handle: "left-target", created_at: map.created_at,
      },
      {
        id: "link-handle-free", map_id: map.id, source_node_id: "node-a", target_node_id: "node-b", kind: "virtual",
        source_handle: null, target_handle: null, created_at: map.created_at,
      },
    ],
  };
  let deletedId: string | null = null;
  await page.route("**/api/v1/maps", async (route) => route.fulfill({ json: [map] }));
  await page.route("**/api/v1/maps/map-a/snapshot", async (route) => route.fulfill({ json: current }));
  await page.route("**/api/v1/maps/map-a/events?after=*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
  });
  await page.route("**/api/v1/links/*", async (route) => {
    deletedId = route.request().url().split("/").at(-1) ?? null;
    current.links = current.links.filter((link) => link.id !== deletedId);
    await route.fulfill({ status: 204, body: "" });
  });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto(baseUrl);
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(2);
  const paths = await page.locator(".react-flow__edge-path").evaluateAll((elements) => elements.map((element) => element.getAttribute("d")));
  expect(paths[0]).not.toBe(paths[1]);
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page.getByRole("region", { name: "Saved links" }).getByRole("button")).toHaveCount(2);
  await page.getByRole("region", { name: "Saved links" }).getByRole("button", { name: /virtual/ }).click();
  await expect(page.getByRole("button", { name: "Delete link" })).toBeVisible();
  await page.getByRole("button", { name: "Delete link" }).click();
  await expect.poll(() => deletedId).toBe("link-handle-free");
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(1);
});
