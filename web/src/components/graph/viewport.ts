import type cytoscape from 'cytoscape'

/** A fit may leave distant nodes offscreen, but never shrinks text below a useful size. */
export function fitReadable(cy: cytoscape.Core, focus?: string | null) {
  if (cy.destroyed() || !cy.width() || !cy.height() || !cy.nodes().length) return
  cy.fit(cy.elements(':visible'), 48)
  const zoom = Math.max(0.7, Math.min(1.15, cy.zoom()))
  cy.zoom(zoom)
  const node = focus ? cy.getElementById(focus) : cy.nodes().first()
  if (cy.elements().renderedBoundingBox().w > cy.width() || cy.elements().renderedBoundingBox().h > cy.height()) cy.center(node)
  else cy.center(cy.elements(':visible'))
}
