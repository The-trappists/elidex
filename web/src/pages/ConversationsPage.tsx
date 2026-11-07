import { Download, MessageSquare, Play, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { Composer } from '../components/chat/Composer'
import { buildCitations } from '../components/chat/citations'
import { MessageList } from '../components/chat/MessageList'
import { ParserOutput } from '../components/chat/ParserOutput'
import { SourceIcon, ThreadList, threadTitle } from '../components/chat/ThreadList'
import { Avatar, Badge, Button, EmptyState, Modal, withToast } from '../components/ui'
import { ORIGIN_STYLE, THREAD_STATUS_STYLE } from '../lib/semantic'
import { useLive } from '../store/live'

export default function ConversationsPage() {
  const params = useParams()
  const threadId = params.threadId ? decodeURIComponent(params.threadId) : null
  const nav = useNavigate()
  const thread = useLive((s) => (threadId ? s.threads[threadId] : undefined))
  const jobs = useLive((s) => s.jobs)
  const assertions = useLive((s) => s.assertions)
  const personas = useLive((s) => s.personas)
  const idle = useLive((s) => s.settings?.idle_seconds ?? null)
  const [hoverItem, setHoverItem] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const latestJob = useMemo(() => {
    if (!thread) return undefined
    return jobs.find((j) => j.id === thread.last_job_id) ?? [...jobs].reverse().find((j) => j.thread_id === thread.id)
  }, [jobs, thread])
  const citations = useMemo(() => (thread ? buildCitations(thread, latestJob, assertions) : new Map()), [thread, latestJob, assertions])

  const remove = async () => {
    if (!thread) return
    const ok = await withToast(async () => {
      await api.deleteThread(thread.id)
      return true
    }, 'Thread deleted')
    setConfirmDelete(false)
    if (ok) nav('/conversations')
  }

  return (
    <div className="flex h-full">
      <aside className="w-80 shrink-0 border-r border-line bg-surface">
        <ThreadList selectedId={threadId} />
      </aside>

      {!thread ? (
        <div className="flex-1">
          <EmptyState
            icon={<MessageSquare size={32} />}
            title={threadId ? 'Thread not found' : 'Select a conversation'}
            hint={threadId ? `No thread with id "${threadId}". It may have been deleted.` : 'Pick a thread on the left to read it and see what the parser extracted.'}
          />
        </div>
      ) : (
        <>
          <section className="flex min-w-0 flex-1 flex-col bg-bg">
            <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
              <SourceIcon source={thread.source} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-sm font-semibold">{threadTitle(thread)}</h1>
                  <Badge className={THREAD_STATUS_STYLE[thread.status].cls}>{THREAD_STATUS_STYLE[thread.status].label}</Badge>
                  <Badge className={ORIGIN_STYLE[thread.origin].cls}>{ORIGIN_STYLE[thread.origin].label}</Badge>
                </div>
                <div className="mt-1 flex -space-x-1.5">
                  {thread.participants.map((n) => (
                    <Avatar key={n} name={n} color={personas.find((p) => p.name === n)?.avatar_color} size={22} className="ring-2 ring-surface" />
                  ))}
                </div>
              </div>
              <Button size="sm" icon={<Play size={13} />} disabled={thread.status === 'processing' || !thread.messages.length} onClick={() => withToast(() => api.processThread(thread.id), 'Processing started')}>
                Process now
              </Button>
              <a href={api.exportTranscriptUrl(thread.id)} download>
                <Button size="sm" icon={<Download size={13} />}>Export transcript</Button>
              </a>
              <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </header>
            <div className="min-h-0 flex-1">
              <MessageList thread={thread} personas={personas} citations={citations} hoverItem={hoverItem} onHoverItem={setHoverItem} />
            </div>
            <div className="bg-surface">
              <Composer key={thread.id} thread={thread} />
            </div>
          </section>

          <aside className="w-[26rem] shrink-0 border-l border-line bg-surface">
            <div className="flex h-11 items-center border-b border-line px-3.5 text-sm font-semibold">Parser output</div>
            <div className="h-[calc(100%-2.75rem)]">
              <ParserOutput thread={thread} jobs={jobs} assertions={assertions} hoverItem={hoverItem} onHoverItem={setHoverItem} idleSeconds={idle} />
            </div>
          </aside>
        </>
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this thread?"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Delete thread</Button>
          </>
        }
      >
        <p className="text-sm">
          "{thread ? threadTitle(thread) : ''}" and its messages will be removed. Knowledge extracted only from this thread is removed with it.
        </p>
      </Modal>
    </div>
  )
}
