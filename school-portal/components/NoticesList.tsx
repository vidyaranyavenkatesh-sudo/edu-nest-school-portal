'use client'
import { useState } from 'react'
import { Alert, Badge, Card, Empty, Loading } from './ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAsync } from '@/lib/hooks'
import { fmtDateTime, q } from '@/lib/util'

/** Official messages from the school office. Opening one marks it as read. */
export default function NoticesList() {
  const { me, school } = useMe()
  const sb = supabaseBrowser()
  const [open, setOpen] = useState<string | null>(null)
  const data = useAsync(async () => {
    const n = await q<any[]>(sb.from('notices').select('id,title,body,sent_at').order('sent_at', { ascending: false }).limit(60))
    const r = await q<any[]>(sb.from('notice_reads').select('notice_id,read_at').eq('profile_id', me.id))
    return { n, read: Object.fromEntries(r.map((x) => [x.notice_id, x.read_at])) as Record<string, string | null> }
  }, [])

  const toggle = async (id: string) => {
    setOpen(open === id ? null : id)
    if (open !== id && data.data && id in data.data.read && !data.data.read[id]) {
      await sb.rpc('mark_notice_read', { p_id: id })
      data.data.read[id] = new Date().toISOString()
      window.dispatchEvent(new Event('edunest:refresh-counts'))
    }
  }
  return (
    <Loading loading={data.loading} error={data.error} hasData={!!data.data}>
      {data.data?.n.length === 0 && <Card><Empty>No official messages yet.</Empty></Card>}
      {(data.data?.n || []).map((n) => {
        const unread = n.id in data.data!.read && !data.data!.read[n.id]
        return (
          <div key={n.id} className="card" style={{ cursor: 'pointer', borderLeft: unread ? '4px solid var(--accent)' : undefined }} onClick={() => toggle(n.id)}>
            <div className="row between">
              <b>{n.title}</b>
              <span className="row"><span className="small muted">{fmtDateTime(n.sent_at, school.timezone)}</span>{unread && <Badge kind="accent">New</Badge>}</span>
            </div>
            {open === n.id ? <p style={{ whiteSpace: 'pre-wrap', marginTop: 10, marginBottom: 0 }}>{n.body}</p> : <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</div>}
          </div>
        )
      })}
      <Alert>These messages come from the school office and cannot be replied to. Speak to your class teacher if you have a question.</Alert>
    </Loading>
  )
}
