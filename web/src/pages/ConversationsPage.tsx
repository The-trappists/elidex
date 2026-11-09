import { Download, MessageSquare, Play, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { Composer } from '../components/chat/Composer'
import { buildCitations } from '../components/chat/citations'
import { MessageList } from '../components/chat/MessageList'
import { ParserOutput } from '../components/chat/ParserOutput'
import { SourceIcon, ThreadList, threadTitle } from '../components/chat/ThreadList'
import { Button, EmptyState, Modal, withToast } from '../components/ui'
import { cn } from '../lib/cn'
import { ORIGIN_STYLE, THREAD_STATUS_STYLE } from '../lib/semantic'
import { useLive } from '../store/live'
import { useDemo } from '../store/demo'

export default function ConversationsPage() {
  const publicDemo = useDemo((s) => s.status?.enabled ?? false)
  const params = useParams()
  const threadId = params.threadId ? decodeURIComponent(params.threadId) : null
  const nav = useNavigate()
  const thread = useLive((s) => (threadId ? s.threads[threadId] : undefined))
  const jobs = useLive((s) => s.jobs)
  const assertions = useLive((s) => s.assertions)
  const personas = useLive((s) => s.personas)
  const idle = useLive((s) => s.settings?.idle_seconds ?? null)
  const threads = useLive((s) => s.threads)
  const [pane, setPane] = useState<'threads' | 'messages' | 'pipeline'>('messages')
  const [hoverItem, setHoverItem] = useState<number | null>(null)

  // No thread in the URL: open the most recent one instead of an empty pane.
  const latestId = useMemo(
    () =>
      Object.values(threads).sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at))[0]?.id,
    [threads],
  )
  useEffect(() => {
    if (!threadId && latestId) nav(`/conversations/${encodeURIComponent(latestId)}`, { replace: true })
  }, [threadId, latestId, nav])
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
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="conversation-tabs flex shrink-0 gap-1 border-b border-line bg-surface p-2"
        role="group"
        aria-label="Conversation view"
      >
        {(['threads', 'messages', 'pipeline'] as const).map((id) => (
          <button
            key={id}
            aria-pressed={pane === id}
            onClick={() => setPane(id)}
            className={cn('flex-1 rounded-md px-3 py-2 text-sm', pane === id ? 'bg-accent-soft font-medium text-accent' : 'text-muted')}
          >
            {id === 'threads' ? 'Conversations' : id === 'messages' ? 'Messages' : 'Pipeline'}
          </button>
        ))}
      </div>
      <div className="conversation-layout flex min-h-0 flex-1" data-pane={pane}>
        <aside
          className="conversation-list w-80 shrink-0 border-r border-line bg-surface"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[data-thread-select]')) setPane('messages')
          }}
        >
          <ThreadList selectedId={threadId} />
        </aside>

        {!thread ? (
          <div className="flex-1">
            <EmptyState
              icon={<MessageSquare size={32} />}
              title={threadId ? 'Thread not found' : 'Select a conversation'}
              hint={
                threadId
                  ? `No thread with id "${threadId}". It may have been deleted.`
                  : 'Pick a thread on the left to read it and see what the parser extracted.'
              }
            />
          </div>
        ) : (
          <>
            <section className="conversation-messages flex min-w-0 flex-1 flex-col bg-bg">
              <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
                <SourceIcon source={thread.source} />
                <div className="thread-heading min-w-0 flex-1">
                  <h1 className="truncate text-sm font-semibold">{threadTitle(thread)}</h1>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{THREAD_STATUS_STYLE[thread.status].label}</span>
                    <span>·</span>
                    <span>{ORIGIN_STYLE[thread.origin].label}</span>
                    <span>·</span>
                    <span className="truncate">{thread.participants.join(', ')}</span>
                  </div>
                </div>
                {!publicDemo && <Button
                  size="sm"
                  variant="primary"
                  icon={<Play size={13} />}
                  disabled={thread.status === 'processing' || !thread.messages.length}
                  onClick={() => withToast(() => api.processThread(thread.id), 'Processing started')}
                >
                  Process now
                </Button>}
                {!publicDemo && (
                  <a href={api.exportTranscriptUrl(thread.id)} download title="Export transcript">
                    <Button size="sm" variant="ghost" aria-label="Export transcript" icon={<Download size={14} />} />
                  </a>
                )}
                {!publicDemo && <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Delete thread"
                  icon={<Trash2 size={14} />}
                  onClick={() => setConfirmDelete(true)}
                />}
              </header>
              <div className="min-h-0 flex-1">
                <MessageList thread={thread} personas={personas} citations={citations} hoverItem={hoverItem} onHoverItem={setHoverItem} />
              </div>
              {!publicDemo && <div className="bg-surface">
                <Composer key={thread.id} thread={thread} />
              </div>}
            </section>

            <aside className="conversation-pipeline w-[28rem] shrink-0 border-l border-line bg-surface">
              <div className="flex h-11 items-center border-b border-line px-4 text-sm font-semibold">Pipeline, step by step</div>
              <div className="h-[calc(100%-2.75rem)]">
                <ParserOutput
                  thread={thread}
                  jobs={jobs}
                  assertions={assertions}
                  hoverItem={hoverItem}
                  onHoverItem={setHoverItem}
                  idleSeconds={idle}
                />
              </div>
            </aside>
          </>
        )}
      </div>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this thread?"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>
              Delete thread
            </Button>
          </>
        }
      >
        <p className="text-sm">
          "{thread ? threadTitle(thread) : ''}" and its messages will be removed. Knowledge extracted only from this thread is removed with
          it.
        </p>
      </Modal>
    </div>
  )
}
