import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
