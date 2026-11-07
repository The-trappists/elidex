import { ArrowLeft, List, Map, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../ui'
import { cn } from '../../lib/cn'

/** The same navigation works by pointer, keyboard and touch; the canvas is never the only entry point. */
export function GraphWorkspace({
  title,
  description,
  toolbar,
  canvas,
  browse,
  details,
  selected,
  onClear,
}: {
  title: string
  description: string
  toolbar: ReactNode
  canvas: ReactNode
  browse: ReactNode
  details: ReactNode
  selected: boolean
  onClear: () => void
}) {
  const [view, setView] = useState<'map' | 'list' | 'details'>(() => (matchMedia('(max-width: 1100px)').matches ? 'list' : 'map'))
  const [previousSelection, setPreviousSelection] = useState(selected)
  if (selected !== previousSelection) {
    setPreviousSelection(selected)
    if (selected) setView('details')
    else if (view === 'details') setView('list')
  }
  return (
    <div className="diagram-workspace" data-view={view}>
      <div className="diagram-heading">
        <div>
          <h2 className="font-display text-2xl font-medium tracking-tight">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
        </div>
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
      <div className="diagram-body">
        <section className="diagram-main" aria-label={title}>
          <div className="diagram-toolbar">{toolbar}</div>
          <div className="diagram-canvas">{canvas}</div>
          <p className="diagram-help">Select an item to follow its connections. Drag to move · pinch or use zoom controls.</p>
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
