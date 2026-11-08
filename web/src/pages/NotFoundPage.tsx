import { Compass } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { EmptyState } from '../components/ui'

export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <EmptyState
      icon={<Compass size={24} />}
      title="This page does not exist"
      hint={
        <>
          Nothing lives at <code className="rounded bg-surface-2 px-1 font-mono">{pathname}</code>. It may have been renamed or the link may contain a typo.
        </>
      }
      action={
        <Link to="/overview" className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-on-accent transition-opacity hover:opacity-90">
          Back to the overview
        </Link>
      }
    />
  )
}
