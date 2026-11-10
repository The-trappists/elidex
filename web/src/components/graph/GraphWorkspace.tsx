import { ArrowLeft, List, Map, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../ui'
import { cn } from '../../lib/cn'

/** The canvas fits its box and the Browse list reaches every item, so the graph needs no controls of its own. */
export function GraphWorkspace({
  title,
  description,
  meta,
  actions,
  status,
  toolbar,
  canvas,
  timeline,
  browse,
  details,
  legend,
  selected,
  onClear,
  variant = 'full',
}: {
  title: string
  description: string
  /** A short line under the description: counts, not prose. */
  meta?: ReactNode
  /** Heading actions on the right: correlations, time chip. */
  actions?: ReactNode
  /** Thin strip above the canvas. */
  status?: ReactNode
  toolbar: ReactNode
  canvas: ReactNode
  /** The simulation timeline band, under the canvas. */
  timeline?: ReactNode
  browse: ReactNode
  details: ReactNode
  legend?: ReactNode
  selected: boolean
  onClear: () => void
  /** `compact` hides the desktop view switch; the rail is visible at ≥ 1101 px. */
  variant?: 'full' | 'compact'
}) {
  const [view, setView] = useState<'map' | 'list' | 'details'>('map')
  const [previousSelection, setPreviousSelection] = useState(selected)
  if (selected !== previousSelection) {
    setPreviousSelection(selected)
    if (selected) setView('details')
    else if (view === 'details') setView('list')
  }
  return (
    <div className={cn('diagram-workspace', variant === 'compact' && 'is-compact')} data-view={view}>
      <div className="diagram-heading">
        <div>
          <h2 className="font-display text-2xl font-medium tracking-tight">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
          {meta && <div className="diagram-meta">{meta}</div>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          <div className="diagram-view-switch" role="group" aria-label="Explore as">
          <Button
            icon={<Map size={15} />}
            aria-pressed={view === 'map'}
            onClick={() => {
              setView('map')
            }}
          >
            Graph
          </Button>
          <Button
            icon={<List size={15} />}
            aria-pressed={!selected && view === 'list'}
            onClick={() => {
              onClear()
              setView('list')
            }}
          >
            Browse
          </Button>
          {selected && (
            <Button aria-pressed={view === 'details'} onClick={() => setView('details')}>
              Details
            </Button>
          )}
          </div>
        </div>
      </div>
      <div className="diagram-body">
        <section className="diagram-main" aria-label={title}>
          <div className="diagram-toolbar">{toolbar}</div>
          {status}
          <div className="diagram-canvas">{canvas}</div>
          {timeline}
          {legend && <div className="diagram-key">{legend}</div>}
        </section>
        <aside
          className={cn('diagram-details', selected && 'is-selected')}
          aria-label={selected ? 'Selected item details' : 'Browse graph items'}
        >
          {selected ? (
            <>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface p-3">
                <Button
                  variant="ghost"
                  icon={<ArrowLeft size={15} />}
                  onClick={() => {
                    onClear()
                    setView('list')
                  }}
                >
                  Back to browse
                </Button>
                <Button
                  variant="ghost"
                  aria-label="Close details"
                  onClick={() => {
                    onClear()
                    setView('map')
                  }}
                  icon={<X size={16} />}
                />
              </div>
              {details}
            </>
          ) : (
            browse
          )}
        </aside>
      </div>
    </div>
  )
}
