import { useState } from 'react'
import { api } from '../../api/client'
import type { LinkKind, Persona, TopologyLink, WbElement, WbSite } from '../../api/types'
import { useLive } from '../../store/live'
import { Avatar, IdChip, withToast } from '../ui'
import { CrudTab, originCol } from './CrudTab'
import { EntityForm, type FieldDef } from './EntityForm'

const opt = (xs: string[]) => xs.map((x) => ({ value: x, label: x }))
const num = (s: string) => (s === '' ? null : Number(s))

/** Shared add/edit state: `editing` is the row being edited, `adding` opens an empty form. */
function useForm<T>() {
  const [state, setState] = useState<{ row: T | null } | null>(null)
  return { open: !!state, row: state?.row ?? null, add: () => setState({ row: null }), edit: (r: T) => setState({ row: r }), close: () => setState(null) }
}

export function ElementsTab() {
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const f = useForm<WbElement>()
  const fields: FieldDef[] = [
    { key: 'id', label: 'ID', kind: 'text', required: true, hint: 'e.g. TRN-099' },
    { key: 'type', label: 'Type', kind: 'text', required: true, hint: 'e.g. router, switch, radio' },
    { key: 'model', label: 'Model', kind: 'text', required: true },
    { key: 'install_year', label: 'Install year', kind: 'number', required: true },
    { key: 'firmware', label: 'Firmware', kind: 'text' },
    { key: 'site_id', label: 'Site', kind: 'select', options: sites.map((s) => ({ value: s.id, label: `${s.id} (${s.name})` })) },
    { key: 'aliases', label: 'Aliases', kind: 'text', hint: 'Comma separated names people use in chat' },
  ]
  const r = f.row
  const initial = r
    ? { id: r.id, type: r.type, model: r.model, install_year: String(r.install_year), firmware: r.firmware ?? '', site_id: r.site_id ?? '', aliases: r.aliases.join(', ') }
    : { id: '', type: '', model: '', install_year: String(new Date().getFullYear()), firmware: '', site_id: '', aliases: '' }
  const save = async (v: Record<string, string>) => {
    const body: WbElement = {
      id: v.id, type: v.type, model: v.model, install_year: Number(v.install_year), firmware: v.firmware || null, site_id: v.site_id || null,
      aliases: v.aliases ? v.aliases.split(',').map((a) => a.trim()).filter(Boolean) : [], origin: r?.origin ?? 'manual',
    }
    return !!(await withToast(async () => { await (r ? api.updateElement(r.id, body) : api.createElement(body)); return true }, 'Element saved'))
  }
  return (
    <>
      <CrudTab
        noun="Element"
        rows={elements}
        onAdd={f.add}
        onEdit={f.edit}
        onDelete={(e) => api.deleteElement(e.id)}
        columns={[
          { key: 'id', header: 'ID', cell: (e) => <IdChip>{e.id}</IdChip> },
          { key: 'type', header: 'Type', cell: (e) => e.type },
          { key: 'model', header: 'Model', cell: (e) => e.model },
          { key: 'year', header: 'Year', cell: (e) => e.install_year },
          { key: 'fw', header: 'Firmware', className: 'text-xs text-muted', cell: (e) => e.firmware ?? '—' },
          { key: 'site', header: 'Site', cell: (e) => e.site_id ?? '—' },
          { key: 'al', header: 'Aliases', className: 'text-xs text-muted', cell: (e) => e.aliases.join(', ') },
          originCol<WbElement>(),
        ]}
      />
      <EntityForm open={f.open} onClose={f.close} title={r ? `Edit ${r.id}` : 'Add element'} fields={fields} initial={initial} editing={!!r} onSubmit={save} />
    </>
  )
}

export function SitesTab() {
  const sites = useLive((s) => s.sites)
  const f = useForm<WbSite>()
  const fields: FieldDef[] = [
    { key: 'id', label: 'ID', kind: 'text', required: true },
    { key: 'name', label: 'Name', kind: 'text', required: true },
    { key: 'region', label: 'Region', kind: 'text' },
    { key: 'lat', label: 'Latitude', kind: 'number', step: 'any' },
    { key: 'lon', label: 'Longitude', kind: 'number', step: 'any' },
  ]
  const r = f.row
  const initial = r
    ? { id: r.id, name: r.name, region: r.region ?? '', lat: r.lat?.toString() ?? '', lon: r.lon?.toString() ?? '' }
    : { id: '', name: '', region: '', lat: '', lon: '' }
  const save = async (v: Record<string, string>) => {
    const body: WbSite = { id: v.id, name: v.name, region: v.region || null, lat: num(v.lat), lon: num(v.lon), origin: r?.origin ?? 'manual' }
    return !!(await withToast(async () => { await (r ? api.updateSite(r.id, body) : api.createSite(body)); return true }, 'Site saved'))
  }
  return (
    <>
      <CrudTab
        noun="Site"
        rows={sites}
        onAdd={f.add}
        onEdit={f.edit}
        onDelete={(s) => api.deleteSite(s.id)}
        columns={[
          { key: 'id', header: 'ID', cell: (s) => <IdChip>{s.id}</IdChip> },
          { key: 'name', header: 'Name', cell: (s) => s.name },
          { key: 'region', header: 'Region', cell: (s) => s.region ?? '—' },
          { key: 'pos', header: 'Lat / Lon', className: 'text-xs text-muted', cell: (s) => (s.lat != null && s.lon != null ? `${s.lat}, ${s.lon}` : '—') },
          originCol<WbSite>(),
        ]}
      />
      <EntityForm open={f.open} onClose={f.close} title={r ? `Edit ${r.id}` : 'Add site'} fields={fields} initial={initial} editing={!!r} onSubmit={save} />
    </>
  )
}

export function LinksTab() {
  const links = useLive((s) => s.links)
  const elements = useLive((s) => s.elements)
  const f = useForm<TopologyLink>()
  const ends = elements.map((e) => ({ value: e.id, label: e.id }))
  const fields: FieldDef[] = [
    { key: 'id', label: 'ID', kind: 'text', required: true },
    { key: 'a', label: 'End A', kind: 'select', required: true, options: ends },
    { key: 'b', label: 'End B', kind: 'select', required: true, options: ends },
    { key: 'kind', label: 'Kind', kind: 'select', required: true, options: opt(['fiber', 'microwave', 'backhaul']) },
  ]
  const r = f.row
  const initial = r ? { id: r.id, a: r.a, b: r.b, kind: r.kind } : { id: '', a: '', b: '', kind: 'fiber' }
  const save = async (v: Record<string, string>) => {
    if (v.a === v.b) {
      await withToast(async () => { throw new Error('A link needs two different ends.') })
      return false
    }
    const body: TopologyLink = { id: v.id, a: v.a, b: v.b, kind: v.kind as LinkKind, origin: r?.origin ?? 'manual' }
    return !!(await withToast(async () => { await (r ? api.updateLink(r.id, body) : api.createLink(body)); return true }, 'Link saved'))
  }
  return (
    <>
      <CrudTab
        noun="Link"
        rows={links}
        onAdd={f.add}
        onEdit={f.edit}
        onDelete={(l) => api.deleteLink(l.id)}
        columns={[
          { key: 'id', header: 'ID', cell: (l) => <IdChip>{l.id}</IdChip> },
          { key: 'a', header: 'End A', cell: (l) => l.a },
          { key: 'b', header: 'End B', cell: (l) => l.b },
          { key: 'kind', header: 'Kind', cell: (l) => l.kind },
          originCol<TopologyLink>(),
        ]}
      />
      <EntityForm open={f.open} onClose={f.close} title={r ? `Edit ${r.id}` : 'Add link'} fields={fields} initial={initial} editing={!!r} onSubmit={save} />
    </>
  )
}

export function PersonasTab() {
  const personas = useLive((s) => s.personas)
  const f = useForm<Persona>()
  const fields: FieldDef[] = [
    { key: 'id', label: 'ID', kind: 'text', required: true, hint: 'A short slug, e.g. "erkki"' },
    { key: 'name', label: 'Name', kind: 'text', required: true, hint: 'Also the author name on messages' },
    { key: 'role', label: 'Role', kind: 'text', required: true },
    { key: 'team', label: 'Team', kind: 'text' },
    { key: 'avatar_color', label: 'Avatar color', kind: 'color' },
    { key: 'expertise', label: 'Expertise', kind: 'textarea', hint: 'Fed to the LLM scenario generator' },
    { key: 'style', label: 'Writing style', kind: 'textarea', hint: 'How they write in chat' },
  ]
  const r = f.row
  const initial = r
    ? { id: r.id, name: r.name, role: r.role, team: r.team ?? '', avatar_color: r.avatar_color, expertise: r.expertise, style: r.style }
    : { id: '', name: '', role: '', team: '', avatar_color: '#6366f1', expertise: '', style: '' }
  const save = async (v: Record<string, string>) => {
    const body: Persona = { id: v.id, name: v.name, role: v.role, team: v.team || null, avatar_color: v.avatar_color, expertise: v.expertise, style: v.style, origin: r?.origin ?? 'manual' }
    return !!(await withToast(async () => { await (r ? api.updatePersona(r.id, body) : api.createPersona(body)); return true }, 'Persona saved'))
  }
  return (
    <>
      <CrudTab
        noun="Persona"
        rows={personas}
        onAdd={f.add}
        onEdit={f.edit}
        onDelete={(p) => api.deletePersona(p.id)}
        columns={[
          { key: 'name', header: 'Name', cell: (p) => (<span className="flex items-center gap-2"><Avatar name={p.name} color={p.avatar_color} size={24} />{p.name}<IdChip>{p.id}</IdChip></span>) },
          { key: 'role', header: 'Role', cell: (p) => p.role },
          { key: 'team', header: 'Team', cell: (p) => p.team ?? '—' },
          { key: 'exp', header: 'Expertise', className: 'max-w-sm text-xs text-muted', cell: (p) => <div className="line-clamp-2">{p.expertise}</div> },
          originCol<Persona>(),
        ]}
      />
      <EntityForm open={f.open} onClose={f.close} title={r ? `Edit ${r.id}` : 'Add persona'} fields={fields} initial={initial} editing={!!r} onSubmit={save} />
    </>
  )
}
