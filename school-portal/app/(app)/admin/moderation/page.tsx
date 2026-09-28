'use client'
import { useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Loading, Modal, PageHead, StatusBadge, Tabs } from '@/components/ui'
import { Thread } from '@/components/Chat'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { fmtDateTime, q } from '@/lib/util'

export default function Moderation() {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const [tab, setTab] = useState('reports')
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null)
  const { busy, run } = useAction()
  const reports = useAsync<any>(async () => {
    const r = await q<any[]>(sb.from('message_reports').select('id,reason,message_body,status,created_at,conversation_id,message_id,reporter:profiles!message_reports_reported_by_fkey(full_name)').order('status', { ascending: false }).order('created_at', { ascending: false }).limit(50))
    const mids = r.map((x) => x.message_id)
    const msgs = mids.length ? await q<any[]>(sb.from('messages').select('id,sender_id').in('id', mids)) : []
    const sids = Array.from(new Set(msgs.map((m) => m.sender_id).filter(Boolean)))
    const names = sids.length ? await q<any[]>(sb.from('profiles').select('id,full_name,role,messaging_disabled').in('id', sids)) : []
    const sender: Record<string, any> = {}
    msgs.forEach((m) => (sender[m.id] = names.find((n) => n.id === m.sender_id)))
    return { r, sender }
  }, [])
  const convs = useAsync<any[]>(() => q(sb.rpc('admin_conversations', { p_limit: 100 })), [])

  const resolve = (id: string, s: string) => run(async () => { await q(sb.rpc('resolve_report', { p_id: id, p_status: s })); reports.reload() })
  const chatOff = (id: string, disabled: boolean) => run(async () => { await q(sb.rpc('set_messaging_disabled', { p_profile: id, p_disabled: disabled })); reports.reload() }, disabled ? 'Chat switched off for that student' : 'Chat switched on')

  return (
    <>
      <PageHead title="Chat review" sub="Reported messages and a look at any conversation. Students are told that staff can read chats." />
      <Tabs tabs={[['reports', 'Reported messages'], ['all', 'All conversations']]} value={tab} onChange={setTab} />
      {tab === 'reports' && (
        <Loading loading={reports.loading} error={reports.error} hasData={!!reports.data}>
          {reports.data?.r.length === 0 && <Card><Empty>Nothing has been reported.</Empty></Card>}
          {(reports.data?.r || []).map((r: any) => {
            const s = reports.data.sender[r.message_id]
            return (
              <Card key={r.id}>
                <div className="row between"><span><b>{r.reporter?.full_name}</b> reported a message from <b>{s?.full_name || 'someone'}</b> · {fmtDateTime(r.created_at, school.timezone)}</span><StatusBadge status={r.status} /></div>
                <div className="muted small">Reason: {r.reason || '—'}</div>
                <blockquote style={{ margin: '8px 0', paddingLeft: 10, borderLeft: '3px solid var(--line)' }}>{r.message_body || '(attachment only)'}</blockquote>
                <div className="row">
                  <Button small onClick={() => setOpen({ id: r.conversation_id, title: 'Reported conversation' })}>Open conversation</Button>
                  {r.status === 'open' && <><Button small onClick={() => resolve(r.id, 'reviewed')}>Mark reviewed</Button><Button small onClick={() => resolve(r.id, 'dismissed')}>Dismiss</Button></>}
                  {s?.role === 'student' && <Button small variant={s.messaging_disabled ? 'primary' : 'danger'} loading={busy} onClick={() => chatOff(s.id, !s.messaging_disabled)}>{s.messaging_disabled ? 'Switch chat on again' : `Switch chat off for ${s.full_name.split(' ')[0]}`}</Button>}
                </div>
              </Card>
            )
          })}
        </Loading>
      )}
      {tab === 'all' && (
        <Loading loading={convs.loading} error={convs.error} hasData={!!convs.data}>
          <Card flush><table className="table">
            <thead><tr><th>Who</th><th>Kind</th><th className="num">Messages</th><th>Last message</th><th></th></tr></thead>
            <tbody>
              {(convs.data || []).map((c) => (
                <tr key={c.id}><td>{c.title ? <b>{c.title}: </b> : null}{c.members}</td><td><Badge>{c.type.replace('_', ' ')}</Badge></td><td className="num">{c.message_count}</td><td className="small muted">{c.last_at ? fmtDateTime(c.last_at, school.timezone) : '—'}</td><td className="num"><Button small onClick={() => setOpen({ id: c.id, title: c.members })}>Read</Button></td></tr>
              ))}
            </tbody>
          </table>{convs.data?.length === 0 && <Empty>No conversations yet.</Empty>}</Card>
        </Loading>
      )}
      {open && (
        <Modal wide title="Conversation (review mode)" onClose={() => setOpen(null)}>
          <Alert kind="warn">You are reading this as school staff. Only review when there is a reason, such as a report.</Alert>
          <div className="chat" style={{ height: 460, gridTemplateColumns: '1fr' }}><Thread convId={open.id} title={open.title} readOnly /></div>
        </Modal>
      )}
    </>
  )
}
