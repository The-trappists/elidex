/*
 * Responsive layout audit. Plain JS, paste into Chrome's javascript_tool (or the devtools console) on any page of the app.
 *
 *   await __audit('/knowledge', 1024, 600, { header: true, wait: 2000, actions: [] })
 *
 * It appends a fixed iframe of exactly w x h (the window cannot be resized), loads the route (same origin),
 * measures inside iframe.contentDocument and removes the iframe. Read-only: it never clicks anything, except
 * the optional `click` selector (use it only for non-mutating things such as opening a drawer or a menu).
 * Options: header (show the TopBar, default true), wait (ms, default 1800), click (CSS selector to click first), keep (leave iframe for screenshots).
 *
 * Result (also left in window.__res[route@WxH]):
 *   pageOverflowX   horizontal page scroll (scrollWidth > width)
 *   offscreen[]     visible elements whose right edge exceeds the viewport
 *   truncated[]     buttons/links/labels/headers whose text is cut (ellipsis or clipped)
 *   ellipsisCount   all ellipsis-truncated elements in main (informational: many are intentional, e.g. long titles)
 *   overlaps[]      pairs of interactive elements whose boxes intersect (not parent/child)
 *   small[]         controls under 24x24 px (under 32 px when width < 768)
 *   headerShare     share of the viewport height used by sidebar-free chrome (TopBar + banners)
 *   tinyScrollers[] scroll containers with clientHeight < 120 px
 *   primary         { share, what }: visible height of the largest list/table/canvas/scroller / viewport height
 *   violations      one-line summary count (pageOverflowX, offscreen, truncated controls, overlaps, small, tinyScrollers)
 */
window.__res = window.__res || {}
window.__audit = async function (route, w, h, opts) {
  opts = Object.assign({ header: true, wait: 1800 }, opts || {})
  const key = route + '@' + w + 'x' + h
  const oldHeader = localStorage.getItem('header-visible')
  localStorage.setItem('header-visible', opts.header ? '1' : '0')
  const f = document.createElement('iframe')
  f.id = '__audit_frame'
  f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;z-index:2147483647;background:#fff`
  document.body.appendChild(f)
  await new Promise((r) => { f.onload = r; f.src = route })
  await new Promise((r) => setTimeout(r, opts.wait))
  const d = f.contentDocument, win = f.contentWindow
  if (opts.click) {
    const el = d.querySelector(opts.click)
    if (el) { el.click(); await new Promise((r) => setTimeout(r, 700)); d.getAnimations().forEach((an) => { try { an.finish() } catch (e) { /* infinite animation */ } }) }
  }
  const sel = (el) => {
    const c = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return el.tagName.toLowerCase() + (c ? '.' + c : '') + (t ? `"${t}"` : '')
  }
  const clipped = (el) => {
    let r = el.getBoundingClientRect()
    let L = r.left, T = r.top, R = r.right, B = r.bottom
    for (let p = el.parentElement; p && p !== d.documentElement; p = p.parentElement) {
      const cs = win.getComputedStyle(p)
      if (cs.position === 'fixed') break
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY)) {
        const q = p.getBoundingClientRect()
        L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom)
      }
    }
    return { L, T, R, B, ok: R - L > 0 && B - T > 0 }
  }
  const visible = (el) => {
    if (!el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const main = d.querySelector('main') || d.body
  const all = [...d.body.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'PATH', 'LINE', 'CIRCLE', 'G', 'TITLE'].includes(e.tagName.toUpperCase()))
  const out = { route, w, h }
  out.pageOverflowX = Math.max(d.documentElement.scrollWidth, d.body.scrollWidth) > w
  out.offscreen = []
  for (const e of all) {
    if (!visible(e) || e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue
    const c = clipped(e)
    if (c.ok && c.R > w + 1 && c.L < w) out.offscreen.push(sel(e) + ' r=' + Math.round(c.R))
  }
  out.offscreen = out.offscreen.slice(0, 6)
  const INTER = 'button,a[href],input,select,textarea,[role=tab],[role=button],[role=menuitem],summary,[tabindex="0"]'
  const onTop = (e) => { // not covered by a drawer, modal or popover
    const c = clipped(e), t = d.elementFromPoint(Math.min(Math.max((c.L + c.R) / 2, 0), w - 1), Math.min(Math.max((c.T + c.B) / 2, 0), h - 1))
    return !t || e.contains(t) || t.contains(e)
  }
  const inter = [...d.querySelectorAll(INTER)].filter((e) => visible(e) && !e.closest('.skip-link') && clipped(e).ok && onTop(e))
  out.truncated = []
  out.ellipsisCount = 0
  for (const e of main.querySelectorAll('*')) {
    if (!visible(e) || e.closest('svg')) continue
    const cut = e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0
    if (!cut) continue
    const cs = win.getComputedStyle(e)
    if (cs.textOverflow === 'ellipsis') out.ellipsisCount++
    const ctl = e.matches('button,a,label,th,[role=tab]')
    if (ctl && /(ellipsis|hidden|clip)/.test(cs.textOverflow + cs.overflowX)) out.truncated.push(sel(e))
  }
  out.truncated = out.truncated.slice(0, 6)
  out.overlaps = []
  const boxes = inter.map((e) => ({ e, c: clipped(e) }))
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue
    const iw = Math.min(a.c.R, b.c.R) - Math.max(a.c.L, b.c.L), ih = Math.min(a.c.B, b.c.B) - Math.max(a.c.T, b.c.T)
    if (iw > 2 && ih > 2) {
      // ignore if one is hidden under an opaque overlay: the topmost element at the centre must be one of them
      const cx = (Math.max(a.c.L, b.c.L) + Math.min(a.c.R, b.c.R)) / 2, cy = (Math.max(a.c.T, b.c.T) + Math.min(a.c.B, b.c.B)) / 2
      const top = d.elementFromPoint(cx, cy)
      if (top && (a.e.contains(top) || b.e.contains(top) || top.contains(a.e) || top.contains(b.e))) out.overlaps.push(sel(a.e) + ' x ' + sel(b.e))
    }
  }
  out.overlaps = out.overlaps.slice(0, 6)
  const min = w < 768 ? 32 : 24
  out.small = []
  for (const { e, c } of boxes) {
    const r = e.getBoundingClientRect()
    if (e.closest('.sr-only') || e.type === 'checkbox' || e.type === 'radio' || e.type === 'range') continue
    if (e.tagName === 'A' && win.getComputedStyle(e).display === 'inline') continue // inline links in text are exempt (WCAG 2.5.8)
    if (c.R - c.L > 0 && (r.width < min - 0.5 || r.height < min - 0.5)) out.small.push(sel(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  out.smallCount = out.small.length
  out.small = out.small.slice(0, 6)
  const top = d.querySelector('.app-topbar'), banner = [...d.querySelectorAll('[role=alert]')].filter(visible)
  let chrome = 0
  if (top) chrome += top.getBoundingClientRect().height
  banner.forEach((b) => { if (!main.contains(b)) chrome += b.getBoundingClientRect().height })
  const mobileBar = d.querySelector('.mobile-bar')
  if (mobileBar && visible(mobileBar)) chrome += mobileBar.getBoundingClientRect().height
  out.headerShare = +(chrome / h).toFixed(2)
  out.tinyScrollers = []
  const cands = []
  for (const e of main.querySelectorAll('*')) {
    if (!visible(e)) continue
    const cs = win.getComputedStyle(e), tag = e.tagName.toLowerCase()
    const scr = /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2
    if (scr && e.clientHeight < 120) out.tinyScrollers.push(sel(e) + ' ' + e.clientHeight + 'px')
    const big = tag === 'canvas' || tag === 'table' || (tag === 'svg' && e.clientWidth > 300) || scr || (/(auto|scroll)/.test(cs.overflowY) && e.children.length > 3) || (e.matches('ul,ol,[role=list]') && e.children.length >= 3)
    if (big) {
      const c = clipped(e), vh = Math.max(0, Math.min(c.B, h) - Math.max(c.T, 0))
      cands.push({ vh, el: e, T: Math.max(c.T, 0), B: Math.min(c.B, h), what: sel(e) + ' ' + Math.round(c.R - c.L) + 'w' })
    }
  }
  // keep only the innermost candidates: an outer page scroller would otherwise always win
  for (let i = cands.length - 1; i >= 0; i--) if (cands.some((o) => o !== cands[i] && cands[i].el.contains(o.el))) cands.splice(i, 1)
  // the page itself may scroll (document or main): then the primary area is whatever is visible below the chrome
  // primary = vertical extent of the innermost lists / tables / canvases (several panels side by side count together)
  const vis = cands.filter((c) => c.vh > 0)
  const span = vis.length ? Math.max(...vis.map((c) => c.B)) - Math.min(...vis.map((c) => c.T)) : 0
  out.primary = { share: +(span / h).toFixed(2), what: vis.length ? vis.length + ' areas, e.g. ' + vis[0].what : 'none' }
  out.tinyScrollers = out.tinyScrollers.slice(0, 4)
  out.violations = (out.pageOverflowX ? 1 : 0) + out.offscreen.length + out.truncated.length + out.overlaps.length + out.smallCount + out.tinyScrollers.length + (out.headerShare > 0.4 ? 1 : 0)
  window.__res[key] = out
  if (!opts.keep) { f.remove() } else { window.__keepFrame = f }
  if (oldHeader === null) localStorage.removeItem('header-visible'); else localStorage.setItem('header-visible', oldHeader)
  return out
}
/* Runs the whole matrix and returns one compact line per route/size. */
window.__matrix = async function (routes, sizes, opts) {
  const lines = []
  for (const r of routes) for (const [w, h] of sizes) {
    const o = await window.__audit(r, w, h, opts)
    lines.push(`${r}@${w}x${h} V=${o.violations} ox=${+o.pageOverflowX} off=${o.offscreen.length} tr=${o.truncated.length} ov=${o.overlaps.length} sm=${o.smallCount} hd=${o.headerShare} tiny=${o.tinyScrollers.length} prim=${o.primary.share}`)
  }
  window.__lines = lines
  return lines.join('\n')
}
