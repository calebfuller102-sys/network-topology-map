# Frontend package

React/Vite SPA for the topology map. It loads the saved Home map, searches,
creates, edits, deletes, moves, and reconnects the topology after reloads.
The local icon manifest and picker are included. Phase 7 adds compact monitor
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

The application ships a deliberately small, generated asset allowlist instead
of loading fonts or icons from public services. `pnpm generate:icons` refreshes
the committed SVG/font files and the synchronized frontend/backend manifests
after an intentional dependency update. `pnpm verify:assets` checks that those
tracked files are current; `pnpm build` performs that check without rewriting
them.

- Material Design Icons come from pinned `@mdi/js` (Apache-2.0).
- Brand marks come from pinned `simple-icons` (CC0-1.0); review the selected
  brand's guidance before a release that uses its mark.
- Inter and JetBrains Mono come from the pinned Fontsource packages (OFL-1.1);
  their license texts ship beside the local font files.

Only static allowlisted asset URLs are rendered at runtime. User-entered icon
IDs never become URLs or markup, and an unavailable asset falls back to the
bundled server icon.
