import { GENERATED_ICON_MANIFEST } from "./generated/icon-manifest";

export interface IconOption {
  id: string;
  label: string;
  glyph: string;
  assetUrl: string;
}

function localAssetUrl(assetFile: string): string {
  return `${import.meta.env.BASE_URL}icons/${assetFile}`;
}

// The generated manifest contains only paths produced at build time from the
// pinned icon packages. Runtime IDs are never interpolated into a URL.
export const ICON_MANIFEST: readonly IconOption[] = GENERATED_ICON_MANIFEST.map((icon) => ({
  id: icon.id,
  label: icon.label,
  glyph: icon.glyph,
  assetUrl: localAssetUrl(icon.assetFile),
}));

export const FALLBACK_ICON: IconOption = ICON_MANIFEST[0];

export function iconForId(iconId: string): IconOption {
  return ICON_MANIFEST.find((icon) => icon.id === iconId) ?? FALLBACK_ICON;
}
