// Canvas force graph: a small physics engine with pan, zoom and drag.
// Topology mode draws each site as a surface around its equipment; selecting a site (or something in it) opens it.
// Colors come from the theme tokens, so the palette stays consistent.
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export type Shape = 'circle' | 'square' | 'hexagon' | 'triangle' | 'diamond'

export interface ForceNode {
  id: string
  label: string
  /** CSS custom property holding the node color, e.g. '--k-person'. */
  color: string
  shape: Shape
  radius: number
  /** Topology: the site this node sits in. */
  group?: string
  /** Topology: this node is a site; its members are drawn on a surface around it. */
  isGroup?: boolean
  /** Open incident: a pulsing red ring. */
  alert?: boolean
  /** Knowledge is attached: a small dot (on equipment, shown once its site is open). */
  badge?: boolean
  /** Sites: pieces of knowledge on the site and its equipment (`total`), and on the site itself (`own`). Shown as a
   * count on the surface; once the site is open, the dots move onto the equipment and only `own` stays. */
  knowledge?: { total: number; own: number }
  /** No longer valid: drawn faint. */
  faded?: boolean
  /** Just added: a pulsing accent ring for a few seconds. */
  fresh?: boolean
}

export interface ForceLink {
  id: string
  source: string
  target: string
  /** 'anchor' ties equipment to its site and is not drawn. 'inter' joins two sites: it is drawn site to site
   * until one of them is open, then from the actual equipment. */
  kind: 'intra' | 'inter' | 'anchor' | 'edge'
  dash?: number[]
  /** CSS custom property for the line color (default --g-link). */
  color?: string
  /** Shown along the line when it is part of the focus. */
  label?: string
}

/** Ring colors for emphasized nodes and links. */
export type Tone = 'accent' | 'bad' | 'warn'
const TONE: Record<Tone, string> = { accent: '--accent', bad: '--bad', warn: '--warn' }

/** Nodes and links to bring forward without a selection, e.g. the problems of an insight
 * (red), their possible common cause (amber), or the knowledge an agent used. */
export interface Emphasis {
  nodes: Record<string, Tone>
  links?: string[]
  linkTone?: Tone
}

export interface ForceCanvasProps {
  mode: 'topology' | 'knowledge'
  nodes: ForceNode[]
  links: ForceLink[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  emphasis?: Emphasis | null
  /** The data is not there yet: show the loading state. */
  loading?: boolean
  /** Search matches: an accent ring. */
  matchIds?: string[]
  /** Room taken by panels laid over the canvas, kept clear when framing. */
  insets?: { top?: number; right?: number; bottom?: number; left?: number }
  ariaLabel: string
}

type SimNode = ForceNode & { x: number; y: number; vx: number; vy: number; mass: number }
type Box = { minX: number; maxX: number; minY: number; maxY: number }
type Cam = { x: number; y: number; scale: number }

interface Sim {
  nodes: SimNode[]
  byId: Map<string, SimNode>
  members: Map<string, SimNode[]>
  links: ForceLink[]
  bounds: Map<string, Box>
  cam: Cam
  /** The user panned or zoomed: stop framing automatically until the selection changes or Fit is pressed. */
  userMoved: boolean
  energy: number
  drag: { id: string | null; sx: number; sy: number; camX: number; camY: number; offX: number; offY: number; moved: boolean } | null
  hover: string | null
  expanded: string | null
  focus: Set<string> | null
  direct: Set<string>
  matches: Set<string>
  tones: Map<string, Tone>
  toneLinks: Set<string>
  linkTone: Tone
  /** Jump the camera to its frame once (after the warm-up) instead of gliding there. */
  snap: boolean
  dirty: boolean
  /** Physics steps still to run off-screen, so a new graph appears settled. */
  warmup: number
  w: number
  h: number
}

const MIN_SCALE = 0.15
const MAX_SCALE = 3.5
const FONT = 'Public Sans, ui-sans-serif, system-ui, sans-serif'

const hash = (s: string) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h
}
/** Stable pseudo-random number in [0, 1) per id, so the first drawing is the same on every visit. */
const rand = (id: string, salt = 0) => (hash(id + ':' + salt) % 10000) / 10000

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const short = (s: string, n = 32) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** Cut `text` with an ellipsis to fit `room` (in the current font). */
function fitText(ctx: CanvasRenderingContext2D, text: string, room: number) {
  if (room <= 0) return ''
  if (ctx.measureText(text).width <= room) return text
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= room) lo = mid
    else hi = mid - 1
  }
  return lo ? text.slice(0, lo) + '…' : ''
}

function tracePath(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number) {
  ctx.beginPath()
  if (shape === 'square') ctx.roundRect(x - r, y - r, r * 2, r * 2, Math.min(4, r / 3))
  else if (shape === 'hexagon' || shape === 'triangle' || shape === 'diamond') {
    const sides = shape === 'hexagon' ? 6 : shape === 'triangle' ? 3 : 4
    const start = shape === 'hexagon' ? 0 : -Math.PI / 2
    const rr = shape === 'triangle' ? r * 1.2 : shape === 'diamond' ? r * 1.15 : r
    for (let j = 0; j < sides; j++) {
      const a = start + (j * Math.PI * 2) / sides
      const px = x + rr * Math.cos(a)
      const py = y + rr * Math.sin(a) + (shape === 'triangle' ? r * 0.2 : 0)
      if (j === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else ctx.arc(x, y, r, 0, Math.PI * 2)
}

export function ForceCanvas({ mode, nodes, links, selectedId, onSelect, emphasis, matchIds, ariaLabel, loading, insets }: ForceCanvasProps) {
  const topo = mode === 'topology'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const insetsRef = useRef(insets)
  insetsRef.current = insets
  const [warming, setWarming] = useState(false)
  const warmingRef = useRef(false)
  const simRef = useRef<Sim>({
    nodes: [],
    byId: new Map(),
    members: new Map(),
    links: [],
    bounds: new Map(),
    cam: { x: 0, y: 0, scale: 0.85 },
    userMoved: false,
    energy: 1,
    drag: null,
    hover: null,
    expanded: null,
    focus: null,
    direct: new Set(),
    matches: new Set(),
    tones: new Map(),
    toneLinks: new Set(),
    linkTone: 'accent',
    snap: true,
    dirty: true,
    warmup: 0,
    w: 0,
    h: 0,
  })

  /** Where a link is drawn: an inter-site link ends on the site until that site is open. */
  const ends = (s: Sim, l: ForceLink): [SimNode | undefined, SimNode | undefined] => {
    let a = s.byId.get(l.source)
    let b = s.byId.get(l.target)
    if (l.kind === 'inter') {
      if (a?.group && a.group !== s.expanded) a = s.byId.get(a.group) ?? a
      if (b?.group && b.group !== s.expanded) b = s.byId.get(b.group) ?? b
    }
    return [a, b]
  }

  // Data in: keep known positions, seed new nodes near their site (or on a spiral).
  useEffect(() => {
    const s = simRef.current
    const old = s.byId
    const byId = new Map<string, SimNode>()
    const groups = nodes.filter((n) => n.isGroup)
    const others = nodes.filter((n) => !n.isGroup)
    let added = 0
    const make = (n: ForceNode, x: number, y: number): SimNode => {
      const prev = old.get(n.id)
      if (!prev) added++
      return { ...n, x: prev?.x ?? x, y: prev?.y ?? y, vx: 0, vy: 0, mass: n.isGroup ? 5 : 1 }
    }
    groups.forEach((n, i) => {
      const angle = (i / Math.max(1, groups.length)) * Math.PI * 2
      const dist = 160 + groups.length * 22 + (i % 3) * 90
      byId.set(n.id, make(n, Math.cos(angle) * dist, Math.sin(angle) * dist))
    })
    others.forEach((n, i) => {
      const g = n.group ? byId.get(n.group) : undefined
      if (g) {
        const a = rand(n.id) * Math.PI * 2
        const d = 30 + rand(n.id, 1) * 45
        byId.set(n.id, make(n, g.x + Math.cos(a) * d, g.y + Math.sin(a) * d))
      } else {
        const a = (i / Math.max(1, others.length)) * Math.PI * 4
        const d = 60 + Math.sqrt(i) * 28
        byId.set(n.id, make(n, Math.cos(a) * d, Math.sin(a) * d))
      }
    })
    s.byId = byId
    s.nodes = [...byId.values()]
    s.links = links.filter((l) => byId.has(l.source) && byId.has(l.target))
    s.members = new Map()
    for (const n of s.nodes) if (n.group && byId.has(n.group)) s.members.set(n.group, [...(s.members.get(n.group) ?? []), n])
    if (added || byId.size !== old.size) s.energy = Math.max(s.energy, added > 3 ? 1 : 0.5)
    // Settle off-screen only for a first drawing or a big change; a few new items settle in place.
    if (added > 3 && added > old.size * 0.3) {
      s.warmup = Math.min(400, 120 + byId.size / 2)
      s.snap = true
      s.userMoved = false
      warmingRef.current = true
      setWarming(true)
    }
    s.dirty = true
  }, [nodes, links])

  // Selection: open the site, and focus the selection and its direct connections.
  const emphasisKey = emphasis
    ? JSON.stringify([Object.entries(emphasis.nodes).sort(), emphasis.links ?? [], emphasis.linkTone ?? 'accent'])
    : ''
  const matchKey = (matchIds ?? []).join('|')
  const prevSelected = useRef<string | null | undefined>(undefined)
  const prevEmphasis = useRef('')
  useEffect(() => {
    const s = simRef.current
    const sel = selectedId ? s.byId.get(selectedId) : undefined
    s.tones = new Map(emphasis ? Object.entries(emphasis.nodes).filter(([id]) => s.byId.has(id)) : [])
    s.toneLinks = new Set(emphasis?.links ?? [])
    s.linkTone = emphasis?.linkTone ?? 'accent'
    const hl = [...s.tones.keys()]
    s.expanded = topo ? (sel?.isGroup ? sel.id : (sel?.group ?? null)) : null
    s.matches = new Set(matchKey ? matchKey.split('|') : [])
    s.direct = new Set()
    if (!sel && !hl.length) s.focus = null
    else {
      const focus = new Set<string>(hl)
      for (const id of hl) {
        const g = s.byId.get(id)?.group
        if (g) focus.add(g)
      }
      if (sel) {
        focus.add(sel.id)
        if (sel.group) focus.add(sel.group)
        // An open site stays whole, so its equipment can be read in place.
        if (s.expanded) for (const m of s.members.get(s.expanded) ?? []) focus.add(m.id)
        const touches = (n: SimNode | undefined) => !!n && (n.id === sel.id || (sel.isGroup && n.group === sel.id))
        for (const l of s.links) {
          if (l.kind === 'anchor') continue
          const raw = [s.byId.get(l.source), s.byId.get(l.target)]
          const [a, b] = ends(s, l)
          if (!a || !b) continue
          if (touches(a) || touches(b) || raw.some(touches)) {
            s.direct.add(l.id)
            for (const n of [a, b]) {
              focus.add(n.id)
              if (n.group) focus.add(n.group)
            }
          }
        }
      }
      s.focus = focus
    }
    if (prevSelected.current !== selectedId || prevEmphasis.current !== emphasisKey) {
      s.userMoved = false
      s.energy = Math.max(s.energy, 0.6)
    }
    prevSelected.current = selectedId
    prevEmphasis.current = emphasisKey
    s.dirty = true
    for (const l of s.links) {
      if (!s.toneLinks.has(l.id)) continue
      // An emphasized link keeps both its ends (and their sites) in the focus.
      for (const n of ends(s, l)) {
        if (!n || !s.focus) continue
        s.focus.add(n.id)
        if (n.group) s.focus.add(n.group)
      }
    }
  }, [selectedId, emphasisKey, matchKey, nodes, links, topo]) // eslint-disable-line react-hooks/exhaustive-deps

  // The loop: physics, camera and drawing.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const s = simRef.current
    let frame = 0
    const calm = matchMedia('(prefers-reduced-motion: reduce)')

    let colors = new Map<string, string>()
    const color = (token: string) => {
      let c = colors.get(token)
      if (!c) {
        c = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#64748b'
        colors.set(token, c)
      }
      return c
    }
    const mo = new MutationObserver(() => {
      colors = new Map()
      s.dirty = true
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const dpr = window.devicePixelRatio || 1
      s.w = parent.clientWidth
      s.h = parent.clientHeight
      canvas.width = Math.max(1, Math.round(s.w * dpr))
      canvas.height = Math.max(1, Math.round(s.h * dpr))
      s.dirty = true
    }
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)
    resize()

    const computeBounds = () => {
      s.bounds = new Map()
      for (const [gid, ms] of s.members) {
        const g = s.byId.get(gid)
        if (!g) continue
        let minX = g.x, maxX = g.x, minY = g.y, maxY = g.y
        for (const m of ms) {
          minX = Math.min(minX, m.x - m.radius)
          maxX = Math.max(maxX, m.x + m.radius)
          minY = Math.min(minY, m.y - m.radius)
          maxY = Math.max(maxY, m.y + m.radius)
        }
        const pad = 26
        s.bounds.set(gid, { minX: minX - pad, maxX: maxX + pad, minY: minY - pad - 20, maxY: maxY + pad })
      }
    }

    const moveGroup = (gid: string, dx: number, dy: number) => {
      const g = s.byId.get(gid)
      if (g) { g.x += dx; g.y += dy }
      for (const m of s.members.get(gid) ?? []) { m.x += dx; m.y += dy }
    }

    const physics = () => {
      const dragging = s.drag?.id ?? null
      if (s.energy < 0.01 && !dragging) return false
      // Outside the focus nodes stay still, except while a new graph settles.
      const focus = s.warmup > 0 ? null : s.focus
      const K = 2000
      const N = s.nodes
      if (topo) computeBounds()

      // Repulsion; sites also push their surfaces apart.
      for (let i = 0; i < N.length; i++) {
        for (let j = i + 1; j < N.length; j++) {
          const a = N[i], b = N[j]
          if (focus && !focus.has(a.id) && !focus.has(b.id)) continue
          let dx = b.x - a.x, dy = b.y - a.y
          if (dx === 0 && dy === 0) { dx = 0.1; dy = 0.1 }
          const distSq = dx * dx + dy * dy
          const dist = Math.sqrt(distSq)
          let force = 0
          if (topo) {
            if (a.isGroup && b.isGroup) {
              const A = s.bounds.get(a.id), B = s.bounds.get(b.id)
              const m = 34
              if (A && B && A.minX - m < B.maxX && A.maxX + m > B.minX && A.minY - m < B.maxY && A.maxY + m > B.minY) {
                const left = A.maxX + m - B.minX, right = B.maxX - (A.minX - m)
                const top = A.maxY + m - B.minY, bottom = B.maxY - (A.minY - m)
                const min = Math.min(left, right, top, bottom)
                let px = 0, py = 0
                if (min === left) px = -1
                else if (min === right) px = 1
                else if (min === top) py = -1
                else py = 1
                const fixedA = dragging === a.id || s.expanded === a.id
                const fixedB = dragging === b.id || s.expanded === b.id
                let ra = min / 2, rb = min / 2
                if (fixedA && !fixedB) { ra = 0; rb = min }
                else if (fixedB && !fixedA) { rb = 0; ra = min }
                const step = 1
                moveGroup(a.id, px * ra * step, py * ra * step)
                moveGroup(b.id, -px * rb * step, -py * rb * step)
              }
              force += (K * 30) / distSq
            } else if (s.expanded && a.group === s.expanded && b.group === s.expanded) force += (K * 5) / distSq
            else if (distSq < 15000) force += K / distSq
          } else if (distSq < 90000) force += (K * 12) / Math.max(distSq, 400)
          if (force > 0) {
            const fx = (dx / dist) * force, fy = (dy / dist) * force
            a.vx -= fx / a.mass; a.vy -= fy / a.mass
            b.vx += fx / b.mass; b.vy += fy / b.mass
          }
        }
      }

      // Springs.
      for (const l of s.links) {
        const [a, b] = l.kind === 'anchor' ? [s.byId.get(l.source), s.byId.get(l.target)] : ends(s, l)
        if (!a || !b || a === b) continue
        if (focus && !focus.has(a.id) && !focus.has(b.id)) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const [base, k] =
          l.kind === 'intra' ? [45, 0.1] : l.kind === 'anchor' ? [38, 0.05] : l.kind === 'inter' ? [150, 0.03] : [80, 0.07]
        // An open site gives its equipment room for names.
        const target = s.expanded && (l.kind === 'intra' || l.kind === 'anchor') && a.group === s.expanded ? base * 1.9 : base
        const f = (dist - target) * k
        const fx = (dx / dist) * f, fy = (dy / dist) * f
        a.vx += fx; a.vy += fy
        b.vx -= fx; b.vy -= fy
      }

      // Gravity, damping, move.
      const gravity = topo ? 0.002 : 0.0012
      for (const n of N) {
        if (focus && !focus.has(n.id)) { n.vx = 0; n.vy = 0; continue }
        n.vx -= n.x * gravity
        n.vy -= n.y * gravity
        if (n.isGroup && s.expanded === n.id && dragging !== n.id) { n.vx = 0; n.vy = 0 }
        else {
          n.vx = clamp(n.vx, -10, 10) * 0.7
          n.vy = clamp(n.vy, -10, 10) * 0.7
        }
        if (dragging !== n.id) {
          n.x += n.vx * s.energy
          n.y += n.vy * s.energy
        }
      }
      if (!dragging) s.energy *= topo ? 0.95 : 0.975
      return true
    }

    /** Frame the focus (or everything) unless the user moved the view. */
    const camera = () => {
      if (s.userMoved || !s.w || !s.h || !s.nodes.length) return false
      const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
      const add = (b: Box) => {
        box.minX = Math.min(box.minX, b.minX); box.maxX = Math.max(box.maxX, b.maxX)
        box.minY = Math.min(box.minY, b.minY); box.maxY = Math.max(box.maxY, b.maxY)
      }
      for (const n of s.nodes) {
        if (s.focus && !s.focus.has(n.id)) continue
        const b = s.bounds.get(n.id)
        if (b) add(b)
        else add({ minX: n.x - n.radius - 20, maxX: n.x + n.radius + 20, minY: n.y - n.radius - 10, maxY: n.y + n.radius + 24 })
      }
      if (!Number.isFinite(box.minX)) return false
      const pad = Math.max(16, Math.min(48, Math.min(s.w, s.h) * 0.06))
      const ins = insetsRef.current ?? {}
      let [il, ir, it, ib] = [ins.left ?? 0, ins.right ?? 0, ins.top ?? 0, ins.bottom ?? 0]
      // A small box cannot spare the room: frame the whole box and let the panel cover a part.
      if (s.w - il - ir < 260) il = ir = 0
      if (s.h - it - ib < 200) it = ib = 0
      const w = Math.max(80, s.w - il - ir), h = Math.max(80, s.h - it - ib)
      const scale = clamp(Math.min((w - pad * 2) / (box.maxX - box.minX), (h - pad * 2) / (box.maxY - box.minY)), MIN_SCALE, 1.6)
      const target = {
        x: -((box.minX + box.maxX) / 2) * scale + (il - ir) / 2,
        y: -((box.minY + box.maxY) / 2) * scale + (it - ib) / 2,
        scale,
      }
      const c = s.cam
      const t = calm.matches || s.snap ? 1 : 0.14
      s.snap = false
      c.x += (target.x - c.x) * t
      c.y += (target.y - c.y) * t
      c.scale += (target.scale - c.scale) * t
      return Math.abs(target.x - c.x) + Math.abs(target.y - c.y) > 0.5 || Math.abs(target.scale - c.scale) > 0.002
    }

    const draw = (time: number) => {
      const dpr = window.devicePixelRatio || 1
      const c = s.cam
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, s.w, s.h)
      ctx.translate(s.w / 2 + c.x, s.h / 2 + c.y)
      ctx.scale(c.scale, c.scale)
      const focus = s.focus
      const px = 1 / c.scale // one screen pixel in world units
      const text = color('--text'), muted = color('--muted'), surface = color('--surface'), bg = color('--bg')
      const accent = color('--accent'), line = color('--line'), linkColor = color('--g-link')
      const sel = selectedRef.current

      // 1. Site surfaces.
      if (topo) {
        for (const [gid, b] of s.bounds) {
          const g = s.byId.get(gid)
          if (!g) continue
          const open = s.expanded === gid
          ctx.globalAlpha = focus && !focus.has(gid) ? 0.35 : 1
          ctx.beginPath()
          ctx.roundRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY, 14)
          ctx.fillStyle = open ? color('--accent-soft') : color('--g-site')
          ctx.globalAlpha *= open ? 0.9 : 0.75
          ctx.fill()
          ctx.globalAlpha = focus && !focus.has(gid) ? 0.35 : 1
          ctx.strokeStyle = open ? accent : g.alert ? color('--bad') : color('--g-site-line')
          ctx.lineWidth = (open ? 2 : 1.2) * Math.max(1, px * 0.8)
          ctx.setLineDash(open ? [] : [5, 4])
          ctx.stroke()
          ctx.setLineDash([])
          // Knowledge count: for the whole site while closed, for the site itself once open.
          const count = open ? (g.knowledge?.own ?? 0) : (g.knowledge?.total ?? 0)
          // About 8 screen pixels, but never wider than a fifth of the surface.
          const br = Math.min(8 * px, (b.maxX - b.minX) / 5)
          if (count > 0) {
            const cx = b.maxX - br - 6, cy = b.minY + br + 5
            ctx.beginPath()
            ctx.arc(cx, cy, br, 0, Math.PI * 2)
            ctx.fillStyle = color('--g-assertion')
            ctx.fill()
            ctx.fillStyle = color('--on-accent')
            ctx.font = `700 ${br * 1.1}px ${FONT}`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(count > 99 ? '99+' : String(count), cx, cy + br * 0.05)
          }
          // Title: about 11 screen pixels, never larger than the band reserved for it, cut to the surface width.
          const fs = Math.min(11 * px, 15)
          if (fs * c.scale >= 6.5) {
            ctx.font = `600 ${fs}px ${FONT}`
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = open ? accent : muted
            const room = b.maxX - b.minX - 16 - (count > 0 ? br * 2 + 8 : 0)
            ctx.fillText(fitText(ctx, g.label, room), b.minX + 9, b.minY + 13)
          }
        }
      }

      // 2. Links.
      const labels: { x: number; y: number; t: string }[] = []
      // Many links around the selection: name only the rarer kinds, so a fan of 'member of' stays quiet.
      const nameCount = new Map<string, number>()
      for (const l of s.links) if (s.direct.has(l.id) && l.label) nameCount.set(l.label, (nameCount.get(l.label) ?? 0) + 1)
      const nameable = (t: string) => s.direct.size <= 10 || (nameCount.get(t) ?? 0) <= 3
      for (const l of s.links) {
        if (l.kind === 'anchor') continue
        const [a, b] = ends(s, l)
        if (!a || !b || a === b) continue
        let alpha = topo ? 0.75 : 0.7
        let stroke = l.color ? color(l.color) : linkColor
        let width = l.kind === 'inter' ? 1.8 : 1.3
        if (s.toneLinks.has(l.id)) {
          alpha = 1
          stroke = color(TONE[s.linkTone])
          width = 3.2
        } else if (focus) {
          if (s.direct.has(l.id)) {
            alpha = 1
            stroke = l.color ? stroke : accent
            width = 2.2
            // Name the link only when it is long enough on screen to hold the name.
            if (l.label && nameable(l.label) && Math.hypot(b.x - a.x, b.y - a.y) * c.scale > 90) labels.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: l.label })
          } else alpha = focus.has(a.id) && focus.has(b.id) ? 0.45 : 0.06
        }
        ctx.globalAlpha = alpha * (a.faded || b.faded ? 0.5 : 1)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = stroke
        ctx.lineWidth = width * Math.max(1, px * 0.6)
        ctx.lineCap = 'round'
        ctx.setLineDash(l.dash ?? [])
        ctx.stroke()
      }
      ctx.setLineDash([])

      // 3. Nodes.
      const pulse = calm.matches ? 0.5 : (Math.sin(time / 280) + 1) / 2
      const labelQueue: { n: SimNode; strong: boolean }[] = []
      for (const n of s.nodes) {
        if (n.isGroup && s.expanded === n.id) continue
        let alpha = focus ? (focus.has(n.id) ? 1 : 0.12) : 1
        if (n.faded) alpha *= 0.45
        ctx.globalAlpha = alpha
        const hue = color(n.color)
        tracePath(ctx, n.shape, n.x, n.y, n.radius)
        ctx.fillStyle = surface
        ctx.fill()
        ctx.globalAlpha = alpha * 0.16
        ctx.fillStyle = hue
        ctx.fill()
        ctx.globalAlpha = alpha
        ctx.strokeStyle = hue
        ctx.lineWidth = 2 * Math.max(1, px * 0.6)
        ctx.setLineDash(n.faded ? [3, 3] : [])
        ctx.stroke()
        ctx.setLineDash([])

        const ring = (r: number, c: string, w: number, a = 1, dash: number[] = []) => {
          ctx.globalAlpha = alpha * a
          tracePath(ctx, n.shape, n.x, n.y, n.radius + r)
          ctx.strokeStyle = c
          ctx.lineWidth = w * Math.max(1, px * 0.6)
          ctx.setLineDash(dash)
          ctx.stroke()
          ctx.setLineDash([])
        }
        if (n.alert) ring(3 + pulse * 3, color('--bad'), 2.2, 0.55 + pulse * 0.45)
        if (n.fresh) ring(4 + pulse * 6, accent, 2.4, 0.5 + pulse * 0.5)
        const tone = s.tones.get(n.id)
        if (tone) {
          ctx.globalAlpha = alpha * (0.18 + pulse * 0.12)
          tracePath(ctx, n.shape, n.x, n.y, n.radius + 7)
          ctx.fillStyle = color(TONE[tone])
          ctx.fill()
          ring(4, color(TONE[tone]), 3)
        }
        if (s.matches.has(n.id)) ring(5, accent, 2, 1, [4, 3])
        if (n.id === sel) ring(5, accent, 2.6)
        else if (n.id === s.hover) ring(4, accent, 2, 0.5)
        if (n.badge && !n.isGroup && (!topo || !n.group || s.expanded === n.group)) {
          ctx.globalAlpha = alpha
          ctx.beginPath()
          ctx.arc(n.x + n.radius * 0.8, n.y - n.radius * 0.8, Math.max(3.5, n.radius * 0.28), 0, Math.PI * 2)
          ctx.fillStyle = color('--g-assertion')
          ctx.fill()
          ctx.strokeStyle = surface
          ctx.lineWidth = 1.5
          ctx.stroke()
        }

        const strong = n.id === sel || n.id === s.hover
        const show =
          strong ||
          s.matches.has(n.id) ||
          s.tones.has(n.id) ||
          (!topo && n.radius >= 20 && c.scale > 0.4) ||
          (n.isGroup ? !s.bounds.has(n.id) : topo ? s.expanded === n.group || c.scale > 1.2 : c.scale > 1.3 || (!!focus && focus.has(n.id) && (focus.size < 40 || c.scale > 0.8)))
        const onSurface = n.isGroup && s.bounds.has(n.id)
        if (show && !onSurface && (!focus || focus.has(n.id) || strong)) labelQueue.push({ n, strong })
      }

      // 4. Labels last, so lines never cross them.
      const fs = 10 * Math.max(1, px * 0.75)
      ctx.font = `500 ${fs}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      // Priority: selected, then hovered, then the rest; a label that would overlap one already placed is skipped.
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = []
      const hits = (r: { x0: number; y0: number; x1: number; y1: number }) => placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)
      const rank = (n: SimNode) => (n.id === sel ? 0 : n.id === s.hover ? 1 : 2)
      labelQueue.sort((a, b) => rank(a.n) - rank(b.n))
      for (const { n, strong } of labelQueue) {
        const t = short(n.label, strong ? 40 : 30)
        const y = n.y + n.radius * (n.shape === 'triangle' ? 1.35 : 1.15) + 4
        const w = ctx.measureText(t).width
        const box = { x0: n.x - w / 2 - 4, y0: y - 2, x1: n.x + w / 2 + 4, y1: y + fs + 3 }
        if (!strong && hits(box)) continue
        placed.push(box)
        ctx.globalAlpha = n.faded && !strong ? 0.6 : 1
        if (strong) {
          // A soft pill keeps the focused label readable over lines and neighbours.
          ctx.globalAlpha = 0.92
          ctx.fillStyle = surface
          ctx.beginPath()
          ctx.roundRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 5)
          ctx.fill()
          ctx.globalAlpha = 1
        }
        ctx.strokeStyle = bg
        ctx.lineWidth = 3.5 * Math.max(1, px * 0.75)
        ctx.strokeText(t, n.x, y)
        ctx.fillStyle = strong ? text : muted
        ctx.fillText(t, n.x, y)
      }
      // A hovered site: its full name above the surface.
      const hb = topo && s.hover ? s.bounds.get(s.hover) : undefined
      if (hb) {
        const g = s.byId.get(s.hover!)!
        ctx.font = `600 ${11 * px}px ${FONT}`
        const tw = ctx.measureText(g.label).width + 14 * px
        const tx = (hb.minX + hb.maxX) / 2, ty = hb.minY - 14 * px
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.roundRect(tx - tw / 2, ty - 10 * px, tw, 20 * px, 6 * px)
        ctx.fillStyle = surface
        ctx.fill()
        ctx.strokeStyle = line
        ctx.lineWidth = px
        ctx.stroke()
        ctx.fillStyle = text
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(g.label, tx, ty)
      }
      ctx.font = `${9 * Math.max(1, px * 0.75)}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const lb of labels) {
        const w = ctx.measureText(lb.t).width + 8 * px
        const eh = 14 * Math.max(1, px * 0.75)
        if (hits({ x0: lb.x - w / 2, y0: lb.y - eh / 2, x1: lb.x + w / 2, y1: lb.y + eh / 2 })) continue
        ctx.globalAlpha = 0.92
        ctx.fillStyle = surface
        ctx.beginPath()
        ctx.roundRect(lb.x - w / 2, lb.y - 7 * Math.max(1, px * 0.75), w, 14 * Math.max(1, px * 0.75), 4)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = muted
        ctx.fillText(lb.t, lb.x, lb.y)
      }
      ctx.globalAlpha = 1
    }

    // Warm-up runs on timers in short slices, so it neither freezes the page nor waits for animation frames
    // (a background window gets very few of those).
    let warmTimer = 0
    const warm = () => {
      warmTimer = 0
      const t0 = performance.now()
      while (s.warmup > 0 && performance.now() - t0 < 16) {
        s.energy = Math.max(s.energy, 0.6)
        physics()
        s.warmup--
      }
      if (s.warmup > 0) {
        warmTimer = window.setTimeout(warm, 0)
        return
      }
      s.energy = 0.3
      s.dirty = true
      if (warmingRef.current) {
        warmingRef.current = false
        setWarming(false)
      }
    }

    const loop = (time: number) => {
      // Settle a new graph off-screen first; nothing is drawn meanwhile.
      if (s.warmup > 0) {
        if (!warmTimer) warmTimer = window.setTimeout(warm, 0)
        frame = requestAnimationFrame(loop)
        return
      }
      const moved = physics()
      const framing = camera()
      const pulsing = !calm.matches && (s.tones.size > 0 || s.nodes.some((n) => n.alert || n.fresh))
      if (moved || framing || pulsing || s.dirty) draw(time)
      s.dirty = false
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)

    // Wheel zoom around the cursor (a native listener: React's wheel handler cannot prevent scrolling).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(warmTimer)
      ro.disconnect()
      mo.disconnect()
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [topo])

  const zoomAt = (sx: number, sy: number, factor: number) => {
    const s = simRef.current
    const c = s.cam
    const next = clamp(c.scale * factor, MIN_SCALE, MAX_SCALE)
    // keep the world point under the cursor in place
    const wx = (sx - s.w / 2 - c.x) / c.scale
    const wy = (sy - s.h / 2 - c.y) / c.scale
    c.scale = next
    c.x = sx - s.w / 2 - wx * next
    c.y = sy - s.h / 2 - wy * next
    s.userMoved = true
    s.dirty = true
  }

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const s = simRef.current
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top
    return { sx, sy, x: (sx - s.w / 2 - s.cam.x) / s.cam.scale, y: (sy - s.h / 2 - s.cam.y) / s.cam.scale }
  }

  const hit = (x: number, y: number): SimNode | null => {
    const s = simRef.current
    const slack = 4 / s.cam.scale
    for (let i = s.nodes.length - 1; i >= 0; i--) {
      const n = s.nodes[i]
      if (n.isGroup && s.expanded === n.id) continue
      if (Math.hypot(x - n.x, y - n.y) < n.radius + slack) return n
    }
    // a site surface: the smallest one under the pointer
    let best: SimNode | null = null
    let area = Infinity
    for (const [gid, b] of s.bounds) {
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue
      const a = (b.maxX - b.minX) * (b.maxY - b.minY)
      if (a < area) { area = a; best = s.byId.get(gid) ?? null }
    }
    return best
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = simRef.current
    const p = toWorld(e)
    const n = hit(p.x, p.y)
    e.currentTarget.setPointerCapture(e.pointerId)
    s.drag = { id: n?.id ?? null, sx: p.sx, sy: p.sy, camX: s.cam.x, camY: s.cam.y, offX: n ? n.x - p.x : 0, offY: n ? n.y - p.y : 0, moved: false }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = simRef.current
    const p = toWorld(e)
    const d = s.drag
    if (!d) {
      const h = hit(p.x, p.y)
      const id = h?.id ?? null
      if (id !== s.hover) {
        s.hover = id
        s.dirty = true
        e.currentTarget.style.cursor = id ? 'pointer' : 'grab'
      }
      return
    }
    if (Math.hypot(p.sx - d.sx, p.sy - d.sy) > 3) d.moved = true
    if (!d.moved) return
    if (d.id) {
      const n = s.byId.get(d.id)
      if (!n) return
      const tx = p.x + d.offX, ty = p.y + d.offY
      const dx = tx - n.x, dy = ty - n.y
      n.x = tx; n.y = ty; n.vx = 0; n.vy = 0
      if (n.isGroup) for (const m of s.members.get(n.id) ?? []) { m.x += dx; m.y += dy; m.vx = 0; m.vy = 0 }
      s.energy = 1
    } else {
      s.cam.x = d.camX + (p.sx - d.sx)
      s.cam.y = d.camY + (p.sy - d.sy)
      e.currentTarget.style.cursor = 'grabbing'
    }
    s.userMoved = true
    s.dirty = true
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = simRef.current
    const d = s.drag
    s.drag = null
    e.currentTarget.style.cursor = s.hover ? 'pointer' : 'grab'
    if (!d || d.moved) return
    const id = d.id
    onSelectRef.current(!id || id === selectedRef.current ? null : id)
  }

  const fit = () => {
    const s = simRef.current
    s.userMoved = false
    s.dirty = true
  }
  const zoomButton = (factor: number) => {
    const s = simRef.current
    zoomAt(s.w / 2, s.h / 2, factor)
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        className="block h-full w-full touch-none select-none"
        style={{ cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (simRef.current.drag = null)}
        onPointerLeave={() => {
          const s = simRef.current
          if (s.hover && !s.drag) { s.hover = null; s.dirty = true }
        }}
      />
      {(loading || warming) && <GraphLoading label={loading ? 'Loading the graph…' : 'Laying out the graph…'} />}
      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm" role="group" aria-label="View controls">
        <button type="button" className="p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Zoom in" title="Zoom in" onClick={() => zoomButton(1.25)}>
          <Plus size={15} />
        </button>
        <button type="button" className="border-t border-line p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Zoom out" title="Zoom out" onClick={() => zoomButton(0.8)}>
          <Minus size={15} />
        </button>
        <button type="button" className="border-t border-line p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Fit to view" title="Fit to view" onClick={fit}>
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  )
}

/** Shown while the data loads or the layout settles. */
export function GraphLoading({ label = 'Loading the graph…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg/80 text-sm text-muted backdrop-blur-[1px]">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden className="graph-loading">
        <line x1="28" y1="10" x2="12" y2="40" />
        <line x1="28" y1="10" x2="44" y2="40" />
        <line x1="12" y1="40" x2="44" y2="40" />
        <circle cx="28" cy="10" r="5" />
        <circle cx="12" cy="40" r="5" />
        <circle cx="44" cy="40" r="5" />
      </svg>
      {label}
    </div>
  )
}
