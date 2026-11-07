import type cytoscape from 'cytoscape'
import { useEffect, useState, type RefObject } from 'react'

type Point = { x: number; y: number }

/** Graphs are pictures that fit their box: no hand zooming, panning or dragging. Selection drives the view. */
export const STATIC_VIEW = {
  userZoomingEnabled: false,
  userPanningEnabled: false,
  boxSelectionEnabled: false,
  autoungrabify: true,
  minZoom: 0.2,
  maxZoom: 1.25,
} as const

const DURATION = 380
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const padding = (cy: cytoscape.Core) => Math.round(Math.max(14, Math.min(44, Math.min(cy.width(), cy.height()) * 0.06)))

/** Size of an element, rounded so sub-pixel jitter does not re-render. */
export function useBoxSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const w = Math.round(el.clientWidth / 8) * 8
        const h = Math.round(el.clientHeight / 8) * 8
        setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
      })
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [ref])
  return size
}

/** How many nodes fit a box while staying readable. Steps keep small resizes from changing the graph. */
export function capacity(w: number, h: number, cell: number, min: number, max: number, step = 4) {
  if (!w || !h) return min
  return Math.max(min, Math.min(max, Math.floor((w * h) / cell / step) * step))
}

export type Frame = (cy: cytoscape.Core) => cytoscape.CollectionReturnValue | null

/** Fit the box to `frame` (default: everything visible). */
export function fitAll(cy: cytoscape.Core, frame?: Frame) {
  if (cy.destroyed() || !cy.width() || !cy.height()) return
  const eles = frame?.(cy) ?? cy.elements(':visible')
  if (eles.nonempty()) cy.fit(eles, padding(cy))
}

export const leafPositions = (cy: cytoscape.Core) =>
  new Map(cy.nodes(':childless').map((n) => [n.id(), { ...n.position() }]))

/** Lay a drawing along its box: a wide drawing in a tall box (or the reverse) is mirrored across the diagonal. */
export function orient(positions: Map<string, Point>, w: number, h: number) {
  const pts = [...positions.values()]
  if (pts.length < 2 || !w || !h) return positions
  const span = (k: 'x' | 'y') => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]))
  const dw = span('x'), dh = span('y')
  // Only flip clear mismatches, so a square-ish drawing does not flip back and forth.
  const mismatch = (w > h * 1.15 && dh > dw * 1.15) || (h > w * 1.15 && dw > dh * 1.15)
  return mismatch ? new Map([...positions].map(([id, p]) => [id, { x: p.y, y: p.x }])) : positions
}

/** Move nodes to their new places and fit the box, gliding from `before` when the graph was already shown. */
export function place(cy: cytoscape.Core, positions: Map<string, Point>, before: Map<string, Point> | null, frame?: Frame) {
  if (cy.destroyed()) return
  const leaves = cy.nodes(':childless')
  cy.stop(true)
  leaves.stop(true)
  const view = { zoom: cy.zoom(), pan: { ...cy.pan() } }
  cy.batch(() => leaves.forEach((n) => { const p = positions.get(n.id()); if (p) n.position(p) }))
  fitAll(cy, frame)
  if (!before || calm()) return
  const target = { zoom: cy.zoom(), pan: { ...cy.pan() } }
  // New nodes appear in place; known nodes glide there with the viewport.
  cy.batch(() => leaves.forEach((n) => { const p = before.get(n.id()); if (p) n.position(p) }))
  cy.viewport(view)
  leaves.forEach((n) => {
    const p = positions.get(n.id())
    if (p && before.has(n.id())) n.animate({ position: p }, { duration: DURATION, easing: 'ease-out-cubic' })
  })
  cy.animate({ zoom: target.zoom, pan: target.pan }, { duration: DURATION, easing: 'ease-out-cubic' })
}
