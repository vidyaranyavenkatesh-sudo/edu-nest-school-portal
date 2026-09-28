'use client'
import Link from 'next/link'
import { Button, Card, Empty, Loading, PageHead } from './ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAsync } from '@/lib/hooks'
import { fmtDateTime, q } from '@/lib/util'

export default function NotificationsList() {
  const { me, school } = useMe()
  const sb = supabaseBrowser()
  const data = useAsync<any[]>(() => q(sb.from('notifications').select('*').eq('profile_id', me.id).order('created_at', { ascending: false }).limit(100)), [])
  const markAll = async () => {
    await sb.rpc('mark_notifications_read')
    window.dispatchEvent(new Event('edunest:refresh-counts'))
    data.reload()
  }
  const unread = (data.data || []).filter((n) => !n.read_at).length
  return (
    <>
      <PageHead title="Alerts" sub="Attendance, notes, report cards and more">
        {unread > 0 && <Button onClick={markAll}>Mark all as read</Button>}
      </PageHead>
      <Loading loading={data.loading} error={data.error} hasData={!!data.data}>
        <Card flush>
          {data.data?.length === 0 && <Empty>Nothing here yet.</Empty>}
          {(data.data || []).map((n) => (
            <div key={n.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)', background: n.read_at ? undefined : 'var(--accent-soft)' }}>
              <div className="row between">
                <b>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</b>
                <span className="small muted">{fmtDateTime(n.created_at, school.timezone)}</span>
              </div>
              {n.body && <div className="muted">{n.body}</div>}
            </div>
          ))}
        </Card>
      </Loading>
    </>
  )
}
