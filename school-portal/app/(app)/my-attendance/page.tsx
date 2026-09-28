'use client'
import { useState } from 'react'
import { Bar, Button, Card, Empty, Loading, PageHead, Stat, StatusBadge } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAsync } from '@/lib/hooks'
import { addMonths, fmtMonth, isoWeekday, monthEnd, monthStart, q, todayISO } from '@/lib/util'

export default function MyAttendance() {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const [month, setMonth] = useState(monthStart(today))

  const rows = useAsync<any[]>(() => q(sb.rpc('my_staff_attendance', { p_from: monthStart(today).slice(0, 8) + '01', p_to: today })), [])
  const monthRows = useAsync<any[]>(() => q(sb.rpc('my_staff_attendance', { p_from: month, p_to: monthEnd(month) })), [month])

  const counts = { present: 0, absent: 0, late: 0, leave: 0 }
  ;(rows.data || []).forEach((r) => (counts[r.status as keyof typeof counts] = (counts[r.status as keyof typeof counts] || 0) + 1)) // this year to date, informational
  const marked = counts.present + counts.absent + counts.late
  const pct = marked > 0 ? Math.round((100 * (counts.present + counts.late)) / marked) : null

  const byDate: Record<string, string> = {}
  ;(monthRows.data || []).forEach((r) => (byDate[r.date] = r.status))
  const first = isoWeekday(month) - 1
  const days = Number(monthEnd(month).slice(8))
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const cls: Record<string, string> = { absent: 'a', late: 'l', leave: 'v', present: 'p' }

  return (
    <>
      <PageHead title="My attendance" sub="The school office's daily record of your attendance. Only the office can mark or change it." />
      <Loading loading={rows.loading} error={rows.error} hasData={!!rows.data}>
        <div className="grid c4">
          <Stat n={pct == null ? '–' : `${pct}%`} l="This month so far" />
          <Stat n={counts.present} l="Present" />
          <Stat n={counts.late} l="Late" />
          <Stat n={counts.absent} l="Absent" sub={counts.leave ? `${counts.leave} on leave` : undefined} />
        </div>
      </Loading>
      <Card title={fmtMonth(month)} actions={<><Button small onClick={() => setMonth(addMonths(month, -1))}>← Previous</Button><Button small onClick={() => setMonth(monthStart(today))}>Today</Button><Button small onClick={() => setMonth(addMonths(month, 1))}>Next →</Button></>}>
        <Loading loading={monthRows.loading} error={monthRows.error} hasData={!!monthRows.data}>
          {monthRows.data?.length === 0 && <Empty>No attendance recorded for {fmtMonth(month)}.</Empty>}
          <div className="cal">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="h">{d}</div>)}
            {cells.map((n, i) => {
              if (!n) return <div key={i} className="d blank" />
              const date = `${month.slice(0, 8)}${String(n).padStart(2, '0')}`
              const status = byDate[date]
              return (
                <div key={i} className={`d ${status ? cls[status] : ''} ${date === today ? 'today' : ''}`}>
                  <b>{n}</b>
                  {status && <span className="small">{status}</span>}
                </div>
              )
            })}
          </div>
          <div className="row small" style={{ marginTop: 12 }}><StatusBadge status="present" /><StatusBadge status="late" /><StatusBadge status="absent" /><StatusBadge status="leave" /></div>
        </Loading>
      </Card>
      <p className="small muted">Need a correction, or planning to be away? Use <b>Leave</b> to apply, or speak to the school office.</p>
    </>
  )
}
