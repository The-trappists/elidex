import type cytoscape from 'cytoscape'

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'

/** Stylesheet built from the design tokens, so light and dark both work. Rebuild when `dark` toggles. */
export function buildStyle(): cytoscape.StylesheetJson {
  const text = css('--text')
  const muted = css('--muted')
  const surface = css('--surface')
  const line = css('--line')
  const element = css('--g-element')
  const site = css('--g-site')
  const klass = css('--g-class')
  const link = css('--g-link')
  const bad = css('--bad')
  const accent = css('--accent')
  const label = { 'font-family': 'Public Sans, ui-sans-serif, system-ui, sans-serif', color: text } as const
  return [
    {
      selector: 'node.site',
      style: {
        shape: 'round-rectangle',
        'background-color': site,
        'background-opacity': 0.55,
        'border-width': 1,
        'border-style': 'dashed',
        'border-color': link,
        label: 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'font-size': 14,
        'text-wrap': 'wrap',
        'text-max-width': '180px',
        'font-weight': 600,
        color: muted,
        'text-margin-y': -3,
        padding: '16px',
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'node.element',
      style: {
        ...label,
        width: 44,
        height: 36,
        shape: 'ellipse',
        'background-color': element,
        'border-width': 2,
        'border-color': surface,
        label: 'data(label)',
        'font-size': 12,
        'text-wrap': 'wrap',
        'text-max-width': '160px',
        'min-zoomed-font-size': 8,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-background-color': surface,
        'text-background-opacity': 0.8,
        'text-background-padding': '1px',
        'transition-property': 'border-width, border-color, overlay-opacity, overlay-padding, opacity',
        'transition-duration': 500,
      },
    },
    { selector: 'node.element[etype = "transmission_node"]', style: { shape: 'round-rectangle', width: 52, height: 36 } },
    { selector: 'node.element[etype = "radio_unit"]', style: { shape: 'triangle', width: 44, height: 40 } },
    { selector: 'node.element[etype *= "router"], node.element[etype *= "switch"]', style: { shape: 'hexagon', width: 48, height: 38 } },
    {
      selector: 'node.klass',
      style: {
        ...label,
        shape: 'round-rectangle',
        width: 160,
        height: 44,
        padding: '8px',
        'background-color': surface,
        'border-width': 1.5,
        'border-color': klass,
        'border-style': 'solid',
        label: 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': '150px',
        'font-size': 12,
        'text-valign': 'center',
        'text-halign': 'center',
        color: klass,
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'node.assertion',
      style: {
        ...label,
        shape: 'round-rectangle',
        width: 170,
        height: 64,
        label: 'data(label)',
        'text-wrap': 'ellipsis',
        'text-max-width': '150px',
        'text-valign': 'center',
        'font-size': 12,
        color: text,
        'background-color': surface,
        'border-width': 2,
        'border-color': 'data(color)',
        'overlay-color': 'data(color)',
        'overlay-opacity': 0,
        'overlay-padding': 4,
      },
    },
    { selector: 'node.assertion[?faded]', style: { opacity: 0.25 } },
    { selector: 'edge', style: { 'curve-style': 'haystack', 'haystack-radius': 0, width: 1.2, 'line-color': link } },
    { selector: 'edge.link', style: { width: 2, 'line-color': link, 'curve-style': 'bezier' } },
    { selector: 'edge.link.microwave', style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 4] } },
    { selector: 'edge.link.backhaul', style: { 'line-style': 'dotted', width: 2.5 } },
    { selector: 'edge.member', style: { 'line-style': 'dotted', 'line-color': klass, width: 1, opacity: 0.55 } },
    {
      selector: 'edge.binding',
      style: { 'curve-style': 'bezier', 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.6, width: 1.3, opacity: 0.85 },
    },
    { selector: 'edge.binding.observed_on', style: { 'line-style': 'dashed', 'line-dash-pattern': [4, 3] } },
    { selector: 'edge.binding[?faded]', style: { opacity: 0.15 } },
    // incidents
    { selector: 'node[?incident]', style: { 'border-color': bad, 'border-width': 3, 'overlay-color': bad, 'overlay-opacity': 0.12, 'overlay-padding': 6 } },
    { selector: 'node[?incident].pulse', style: { 'border-width': 5, 'overlay-opacity': 0.28, 'overlay-padding': 12 } },
    // interaction
    { selector: 'node.hl', style: { 'border-color': accent, 'border-width': 4, 'overlay-color': accent, 'overlay-opacity': 0.18, 'overlay-padding': 8 } },
    { selector: 'node:selected, node.sel', style: { 'border-color': accent, 'border-width': 4, 'overlay-color': accent, 'overlay-opacity': 0.22, 'overlay-padding': 8 } },
    { selector: 'node.site.sel', style: { 'border-color': accent, 'border-width': 2, 'border-style': 'solid' } },
    { selector: 'node.assertion.sel, node.assertion.hl', style: { 'border-width': 3 } },
    { selector: 'edge.dim, node.dim', style: { opacity: 0.12 } },
    { selector: '.hover-fade', style: { opacity: 0.18 } },
    { selector: 'node.hover-on', style: { 'overlay-color': accent, 'overlay-opacity': 0.14, 'overlay-padding': 7 } },
    { selector: 'edge.hover-on', style: { width: 2.5, 'line-color': accent, opacity: 1 } },
    { selector: '.context-hidden', style: { display: 'none' } },
    { selector: 'node.site[?collapsed]', style: { width: 210, height: 76, padding: '8px', 'text-valign': 'center', 'text-margin-y': 0, 'text-wrap': 'wrap', 'text-max-width': '200px', 'border-style': 'solid', 'background-color': surface } },
    { selector: 'edge.link', style: { label: 'data(label)', 'font-size': 10, color: muted, 'text-background-color': surface, 'text-background-opacity': 1, 'text-background-padding': '3px' } },
    { selector: 'core', style: { 'active-bg-color': line } },
  ] as unknown as cytoscape.StylesheetJson
}
