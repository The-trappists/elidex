import { useEffect, useState } from 'react'
import { Button, Field, Input, Modal, Select, Textarea } from '../ui'

export interface FieldDef {
  key: string
  label: string
  kind: 'text' | 'number' | 'select' | 'color' | 'textarea'
  required?: boolean
  options?: { value: string; label: string }[]
  hint?: string
  step?: string
}

/** Config-driven add/edit form with required and number validation. `onSubmit` resolves true when saved. */
export function EntityForm({
  open,
  onClose,
  title,
  fields,
  initial,
  editing,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  fields: FieldDef[]
  initial: Record<string, string>
  editing: boolean
  onSubmit: (values: Record<string, string>) => Promise<boolean>
}) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setValues(initial)
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    for (const f of fields) {
      const v = (values[f.key] ?? '').trim()
      if (f.required && !v) return setError(`${f.label} is required.`)
      if (f.kind === 'number' && v && Number.isNaN(Number(v))) return setError(`${f.label} must be a number.`)
    }
    setError(null)
    setBusy(true)
    const ok = await onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])))
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          {error && <span className="mr-auto self-center text-xs text-bad">{error}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {editing ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {fields.map((f) => {
          const common = { value: values[f.key] ?? '', onChange: (e: { target: { value: string } }) => setValues({ ...values, [f.key]: e.target.value }) }
          const label = f.required ? `${f.label} *` : f.label
          return (
            <Field key={f.key} label={label} hint={f.hint}>
              {f.kind === 'select' ? (
                <Select {...common}>
                  {!f.required && <option value="">None</option>}
                  {f.required && !common.value && <option value="">Select…</option>}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : f.kind === 'textarea' ? (
                <Textarea rows={3} {...common} />
              ) : f.kind === 'color' ? (
                <Input type="color" className="w-20 p-1" {...common} />
              ) : (
                <Input type={f.kind === 'number' ? 'number' : 'text'} step={f.step} {...common} disabled={editing && f.key === 'id'} />
              )}
            </Field>
          )
        })}
      </div>
    </Modal>
  )
}
