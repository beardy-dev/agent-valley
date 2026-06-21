// Minimal HTML-escaping for untrusted strings (e.g. agent-supplied names)
// before they're interpolated into server-rendered HTML. The viewer page's
// client-side <script> keeps its own copy of this logic — it runs in the
// browser and can't import a server module.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// Wraps a single ASCII symbol in a colored <span>, used wherever a crop or
// debris icon is rendered server-side (legend, market price tables, etc).
export function swatch(color: string, symbol: string): string {
  return `<span style="color:${color};">${symbol}</span>`;
}
