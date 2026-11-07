import type cytoscape from 'cytoscape'

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'

/** Stylesheet built from the design tokens, so light and dark both work. Rebuilt when the theme toggles. */
export function buildStyle(): cytoscape.StylesheetJson {
  const text = css('--text')
  const muted = css('--muted')
  const surface = css('--surface')
  const element = css('--g-element')
  const site = css('--g-site')
  const klass = css('--g-class')
  const knowledge = css('--g-assertion')
  const link = css('--g-link')
  const bad = css('--bad')
  const warn = css('--warn')
  const accent = css('--accent')
  const font = { 'font-family': 'Public Sans, ui-sans-serif, system-ui, sans-serif', color: text, 'min-zoomed-font-size': 7 } as const
  return [
    // A site holding its equipment: a quiet frame with the name on top.
    {
      selector: 'node.site',
      style: {
        ...font,
        shape: 'round-rectangle',
        'corner-radius': 12,
        'background-color': site,
        'background-opacity': 0.6,
        'border-width': 1,
        'border-style': 'dashed',
        'border-color': link,
        label: 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -6,
        'font-size': 12,
        'font-weight': 600,
        color: muted,
        'text-wrap': 'wrap',
        'text-max-width': '200px',
        padding: '18px',
        'overlay-opacity': 0,
      },
    },
    // A closed site: a card with its name and what it holds.
    {
      selector: 'node.site[?collapsed]',
      style: {
        width: 176,
        height: 56,
        padding: '0px',
        'corner-radius': 10,
        'background-color': surface,
        'background-opacity': 1,
        'border-style': 'solid',
        'border-width': 1.5,
        'text-valign': 'center',
        'text-margin-y': 0,
        'text-max-width': '160px',
        'line-height': 1.35,
        color: text,
        'font-weight': 500,
      },
    },
    { selector: 'node.site[?collapsed][knowledge > 0]', style: { 'border-color': knowledge, 'border-width': 2 } },
    {
      selector: 'node.element',
      style: {
        ...font,
        width: 26,
        height: 26,
        shape: 'ellipse',
        'background-color': element,
        'border-width': 2,
        'border-color': surface,
        label: 'data(label)',
        'font-size': 10,
        'line-height': 1.25,
        'text-wrap': 'wrap',
        'text-max-width': '120px',
        'text-valign': 'bottom',
        'text-margin-y': 5,
        'text-background-color': surface,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-background-shape': 'round-rectangle',
        'transition-property': 'border-width, border-color, overlay-opacity, overlay-padding, opacity',
        'transition-duration': 300,
      },
    },
    { selector: 'node.element[etype = "transmission_node"]', style: { shape: 'round-rectangle', 'corner-radius': 5, width: 30, height: 24 } },
    { selector: 'node.element[etype = "radio_unit"]', style: { shape: 'round-triangle', width: 28, height: 26 } },
    { selector: 'node.element[etype *= "router"], node.element[etype *= "switch"]', style: { shape: 'round-hexagon', width: 30, height: 26 } },
    {
      selector: 'node.klass',
      style: {
        ...font,
        shape: 'round-rectangle',
        'corner-radius': 20,
        width: 150,
        height: 36,
        'background-color': surface,
        'border-width': 1.5,
        'border-color': klass,
        label: 'data(label)',
        'text-wrap': 'ellipsis',
        'text-max-width': '134px',
        'font-size': 11,
        'font-weight': 500,
        'text-valign': 'center',
        color: klass,
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'node.assertion',
      style: {
        ...font,
        shape: 'round-rectangle',
        'corner-radius': 8,
        width: 156,
        height: 46,
        label: 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': '140px',
        'text-valign': 'center',
        'font-size': 11,
        'font-weight': 500,
        'line-height': 1.25,
        'background-color': 'data(color)',
        'background-opacity': 0.1,
        'border-width': 1.5,
        'border-color': 'data(color)',
        'overlay-color': 'data(color)',
        'overlay-opacity': 0,
        'overlay-padding': 4,
      },
    },
    { selector: 'node.assertion[?faded]', style: { opacity: 0.3, 'border-style': 'dashed' } },
    { selector: 'edge', style: { 'curve-style': 'straight', width: 1.2, 'line-color': link, opacity: 0.8 } },
    {
      selector: 'edge.link',
      style: {
        width: 2,
        'line-cap': 'round',
        label: 'data(label)',
        'font-size': 10,
        color: muted,
        'text-background-color': surface,
        'text-background-opacity': 1,
        'text-background-padding': '3px',
        'text-background-shape': 'round-rectangle',
      },
    },
    { selector: 'edge.link.microwave', style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 4] } },
    { selector: 'edge.link.backhaul', style: { 'line-style': 'dotted', width: 2.5 } },
    { selector: 'edge.member', style: { 'line-style': 'dotted', 'line-color': klass, width: 1, opacity: 0.5 } },
    {
      selector: 'edge.binding',
      style: { 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.6, width: 1.3, opacity: 0.85 },
    },
    { selector: 'edge.binding.observed_on', style: { 'line-style': 'dashed', 'line-dash-pattern': [4, 3] } },
    { selector: 'edge.binding[?faded]', style: { opacity: 0.15 } },
    // incidents
    { selector: 'node[?incident]', style: { 'border-color': bad, 'border-width': 3, 'overlay-color': bad, 'overlay-opacity': 0.1, 'overlay-padding': 5 } },
    { selector: 'node[?incident].pulse', style: { 'overlay-opacity': 0.24, 'overlay-padding': 10 } },
    // interaction
    { selector: 'node.hl', style: { 'border-color': accent, 'border-width': 3, 'overlay-color': accent, 'overlay-opacity': 0.14, 'overlay-padding': 6 } },
    { selector: 'node.sel', style: { 'border-color': accent, 'border-width': 3, 'overlay-color': accent, 'overlay-opacity': 0.16, 'overlay-padding': 6 } },
    { selector: 'node.site.sel', style: { 'border-width': 1.5, 'border-style': 'solid', 'overlay-opacity': 0 } },
    // pattern focus (Patterns page): the problems in red, the possible common cause in amber, the links between them
    { selector: 'edge.dim, node.dim', style: { opacity: 0.14 } },
    { selector: 'node.pb', style: { 'border-color': bad, 'border-width': 4, 'overlay-color': bad, 'overlay-opacity': 0.18, 'overlay-padding': 8, 'font-weight': 'bold' } },
    { selector: 'node.suspect', style: { 'border-color': warn, 'border-width': 5, 'border-style': 'double', 'overlay-color': warn, 'overlay-opacity': 0.26, 'overlay-padding': 12, 'font-weight': 'bold' } },
    { selector: 'edge.pl', style: { 'line-color': bad, width: 4, opacity: 1, 'z-index': 10 } },
    { selector: '.hover-fade', style: { opacity: 0.2 } },
    { selector: 'node.hover-on', style: { 'overlay-color': accent, 'overlay-opacity': 0.1, 'overlay-padding': 5 } },
    { selector: 'edge.hover-on', style: { width: 2.5, 'line-color': accent, opacity: 1 } },
    { selector: '.context-hidden', style: { display: 'none' } },
    { selector: 'core', style: { 'active-bg-opacity': 0 } },
  ] as unknown as cytoscape.StylesheetJson
}
