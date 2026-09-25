# Frontend package

React/Vite SPA for the topology map. It loads the saved Home map, searches,
creates, edits, deletes, moves, and reconnects the topology after reloads.
The local icon manifest and picker are included. Typed non-bundled Material
Design and Simple Icon identifiers load from the approved Iconify image service
when connected, with the local fallback retained for offline use. Phase 7 adds compact monitor
CRUD, per-check latest-result diagnostics, and receipt-based manual checks;
live stream recovery reloads the authoritative snapshot after reconnecting.

## Local development

Set `VITE_API_PROXY_TARGET` in a local environment file to the API origin, then
run:

```text
pnpm install --frozen-lockfile
pnpm dev
```

The production API base defaults to the same-origin `/api/v1` path so the NGINX
gateway can serve the SPA and proxy API requests without CORS configuration.

## Local fonts and icons

The application ships a deliberately small, generated local asset allowlist.
`pnpm generate:icons` refreshes the committed SVG/font files and synchronized
frontend/backend manifests after an intentional dependency update.
`pnpm verify:assets` checks that those tracked files are current; `pnpm build`
performs that check without rewriting them.

- Material Design Icons come from pinned `@mdi/js` (Apache-2.0).
- Brand marks come from pinned `simple-icons` (CC0-1.0); review the selected
  brand's guidance before a release that uses its mark.
- Inter and JetBrains Mono come from the pinned Fontsource packages (OFL-1.1);
  their license texts ship beside the local font files.

Bundled icons render from local static files. A normalized `mdi-<slug>` or
`si-<slug>` ID not in the local manifest may be rendered as an image from
the approved Iconify host; the browser policy permits only that remote image
host. The ID is constrained before it becomes a URL, remote SVG markup is
never inserted into the document, and an unavailable icon falls back to the
bundled server icon.
