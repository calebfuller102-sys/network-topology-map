const REMOTE_MDI_ICON_ID = /^mdi-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A saved non-bundled MDI value is limited to one predictable API path. */
export function isRemoteMdiIconId(iconId: string): boolean {
  return REMOTE_MDI_ICON_ID.test(iconId);
}

export function remoteMdiAssetUrl(iconId: string): string | null {
  if (!isRemoteMdiIconId(iconId)) {
    return null;
  }
  // External SVG images cannot inherit the cyan color from the node glyph.
  // Iconify's documented color parameter bakes the existing accent into the
  // image without admitting any user-controlled URL parameters.
  return `https://api.iconify.design/mdi/${iconId.slice("mdi-".length)}.svg?color=%2379cde3`;
}
