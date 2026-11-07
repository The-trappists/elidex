import { PageIntro } from '../components/layout/PageIntro'
import { useState } from 'react'
import { DataActions } from '../components/data/DataActions'
import { IncidentsTab } from '../components/data/IncidentsTab'
import { ElementsTab, LinksTab, PersonasTab, SitesTab } from '../components/data/InventoryTabs'
import { ScenariosTab } from '../components/data/ScenariosTab'
import { Tabs } from '../components/ui'
import { useLive } from '../store/live'

type Tab = 'elements' | 'sites' | 'links' | 'personas' | 'scenarios' | 'incidents'

export default function DataPage() {
  const [tab, setTab] = useState<Tab>('elements')
  const n = {
    elements: useLive((s) => s.elements.length),
    sites: useLive((s) => s.sites.length),
    links: useLive((s) => s.links.length),
    personas: useLive((s) => s.personas.length),
    scenarios: useLive((s) => s.scenarios.length),
    incidents: useLive((s) => Object.keys(s.incidents).length),
  }
  return (
    <div className="flex h-full flex-col">
      <PageIntro title="Build a useful demonstration" description="Manage the equipment, people and scenarios used by this workbench." />
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { id: 'elements', label: 'Equipment', count: n.elements },
            { id: 'sites', label: 'Sites', count: n.sites },
            { id: 'links', label: 'Connections', count: n.links },
            { id: 'personas', label: 'People', count: n.personas },
            { id: 'scenarios', label: 'Scenarios', count: n.scenarios },
            { id: 'incidents', label: 'Incidents', count: n.incidents },
          ]}
        />
        <div className="ml-auto"><DataActions /></div>
      </div>
      <div className="min-h-0 flex-1 bg-surface">
        {tab === 'elements' && <ElementsTab />}
        {tab === 'sites' && <SitesTab />}
        {tab === 'links' && <LinksTab />}
        {tab === 'personas' && <PersonasTab />}
        {tab === 'scenarios' && <ScenariosTab />}
        {tab === 'incidents' && <IncidentsTab />}
      </div>
    </div>
  )
}
