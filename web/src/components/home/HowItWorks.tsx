import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

const STEPS = [
  {
    number: '01',
    title: 'Capture',
    body: 'Specialists keep working in Teams and email. ElidEx listens in the background.',
    route: '/conversations',
    link: 'Conversations',
  },
  {
    number: '02',
    title: 'Link',
    body: 'Each rule is bound to the element, model and site it concerns — or to nothing at all.',
    route: '/graph',
    link: 'Knowledge graph',
  },
  {
    number: '03',
    title: 'Act',
    body: 'An agent retrieves it through MCP, checks the conditions, and acts.',
    route: '/agent',
    link: 'Agent tester',
  },
] as const

export function HowItWorks() {
  return (
    <div className="mx-auto mt-10 grid max-w-5xl gap-6 md:grid-cols-3">
      {STEPS.map((step) => (
        <div key={step.number} className="border-t border-line pt-5">
          <p className="font-mono text-[11px] text-accent">{step.number}</p>
          <h3 className="mt-2 font-display text-lg font-medium">{step.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
          <Link
            to={step.route}
            className="mt-3 inline-flex min-h-8 items-center gap-1 py-2 text-sm font-medium text-accent hover:opacity-80"
          >
            {step.link} <ArrowRight size={14} />
          </Link>
        </div>
      ))}
    </div>
  )
}
