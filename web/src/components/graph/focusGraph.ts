import type cytoscape from 'cytoscape'

/** Reflow a local neighbourhood to the viewport instead of shrinking distant nodes into it. */
export function focusGraph(cy: cytoscape.Core, selected: cytoscape.CollectionReturnValue) {
  if (selected.empty() || cy.width() <= 0 || cy.height() <= 0) return
  const hood = selected.isParent()
    ? selected.union(selected.descendants()).union(selected.descendants().connectedEdges())
    : selected.closedNeighborhood()
  const visible = hood.union(hood.nodes().ancestors())
  cy.elements().removeClass('context-hidden')
  cy.elements().not(visible).addClass('context-hidden')
  const leaves = hood.nodes().filter((n) => !n.isParent())
  const root = (selected.isParent() ? leaves.first() : selected) as cytoscape.NodeSingular
  const others = leaves.not(root)
  const columns = cy.width() > 600 ? 3 : 1
  cy.batch(() => {
    root.position({ x: 0, y: 0 })
    others.forEach((n, i) => {
      ;(n as cytoscape.NodeSingular).position({
        x: ((i % columns) - (Math.min(columns, others.length) - 1) / 2) * 210,
        y: 150 + Math.floor(i / columns) * 120,
      })
    })
  })
  cy.fit(visible, 32)
  if (cy.zoom() < 0.65) {
    cy.zoom(0.85)
    cy.center(root)
  } else if (cy.zoom() > 1.2) {
    cy.zoom(1.2)
    cy.center(visible)
  }
}
