'use client'
import Link from 'next/link'
import { Alert, Badge, Button, Card, Empty, Loading, PageHead, Stat, StatusBadge } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { classLabel, fmtDate, fmtTime, isoWeekday, q, todayISO } from '@/lib/util'

export default function Home() {
  const { me, school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const { busy, run } = useAction()

  const d = useAsync<any>(async () => {
    const stats = me.role === 'admin' ? await q<any>(sb.rpc('admin_stats')) : null
    // my periods today (teachers), and substitution duties
    const [periods, duties] = await Promise.all([
      me.role === 'teacher'
        ? q<any[]>(sb.from('timetable_entries').select('id,class_id,period:periods(number,start_time,end_time),subject:subjects(name),class:classes(id,section,grade:grade_levels(name))').eq('teacher_id', me.id).eq('weekday', isoWeekday(today)))
        : Promise.resolve([]),
      q<any[]>(sb.from('substitutions').select('id,date,status,period:periods(number,start_time),entry:timetable_entries(class:classes(id,section,grade:grade_levels(name)),subject:subjects(name))').eq('substitute_id', me.id).in('status', ['approved', 'accepted']).gte('date', today).order('date')),
    ])
    const classIds = Array.from(new Set([...periods.map((p) => p.class_id), ...duties.filter((x) => x.date === today).map((x) => x.entry?.class?.id)].filter(Boolean)))
    const marked = classIds.length ? await q<string[]>(sb.rpc('marked_classes', { p_date: today, p_class_ids: classIds })) : []
    const openSubs = me.role === 'admin' ? await q<any[]>(sb.from('substitutions').select('id').gte('date', today).in('status', ['unassigned', 'suggested', 'declined'])) : []
    return { stats, periods: periods.sort((a, b) => a.period.number - b.period.number), duties, marked: new Set(marked), openSubs: openSubs.length }
  }, [])
  const v = d.data

  const respond = (id: string, accept: boolean) => run(async () => { await q(sb.rpc('respond_substitution', { p_id: id, p_accept: accept })); d.reload() }, accept ? 'Accepted' : 'Declined')

  return (
    <>
      <PageHead title={`Hello, ${me.full_name.split(' ')[0]}`} sub={`${fmtDate(today)} · ${me.role === 'admin' ? 'School office' : 'Teacher'}`} />
      <Loading loading={d.loading} error={d.error} hasData={!!v}>
        {v?.stats && (
          <>
            <div className="grid c4">
              <Stat n={v.stats.students} l="Students" />
              <Stat n={v.stats.teachers} l="Teachers" />
              <Stat n={v.stats.present_today} l="Present today" sub={`${v.stats.absent_today} absent`} />
              <Stat n={v.stats.classes} l="Classes this year" />
            </div>
            {(v.stats.pending_leaves > 0 || v.stats.open_reports > 0 || v.openSubs > 0) && (
              <Alert kind="warn">
                <b>Needs your attention: </b>
                {v.stats.pending_leaves > 0 && <><Link href="/leave">{v.stats.pending_leaves} leave request{v.stats.pending_leaves > 1 ? 's' : ''}</Link>{' · '}</>}
                {v.openSubs > 0 && <><Link href="/substitutions">{v.openSubs} substitution{v.openSubs > 1 ? 's' : ''} to decide</Link>{' · '}</>}
                {v.stats.open_reports > 0 && <Link href="/admin/moderation">{v.stats.open_reports} reported message{v.stats.open_reports > 1 ? 's' : ''}</Link>}
              </Alert>
            )}
          </>
        )}
        <div className="grid c2">
          {me.role === 'teacher' && (
            <Card title="My periods today">
              {v?.periods.length === 0 && <Empty>No lessons on your timetable today.</Empty>}
              <table className="table"><tbody>
                {v?.periods.map((p: any) => (
                  <tr key={p.id}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>P{p.period.number}<br />{fmtTime(p.period.start_time)}</td>
                    <td><b>Class {classLabel(p.class)}</b><br /><span className="small muted">{p.subject.name}</span></td>
                    <td className="num">
                      {v.marked.has(p.class_id) ? <Badge kind="good">Attendance done</Badge> : <Link className="btn small primary" href={`/attendance?class=${p.class_id}`}>Take attendance</Link>}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </Card>
          )}
          <Card title="Substitution duties">
            {v?.duties.length === 0 && <Empty>No substitution duties coming up.</Empty>}
            {v?.duties.map((s: any) => (
              <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row between">
                  <span><b>{fmtDate(s.date)}</b> · P{s.period?.number} · Class {classLabel(s.entry?.class)} · {s.entry?.subject?.name}</span>
                  <StatusBadge status={s.status} />
                </div>
                {s.status === 'approved' && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <Button small variant="primary" loading={busy} onClick={() => respond(s.id, true)}>Accept</Button>
                    <Button small variant="danger" loading={busy} onClick={() => respond(s.id, false)}>Decline</Button>
                  </div>
                )}
                {s.status === 'accepted' && s.date === today && v.marked && (
                  <div style={{ marginTop: 6 }}><Link className="btn small" href={`/attendance?class=${s.entry?.class?.id}`}>Take attendance for this class</Link></div>
                )}
              </div>
            ))}
          </Card>
          <Card title="Quick links">
            <div className="stack">
              <Link href="/attendance">Take attendance</Link>
              <Link href="/notes">Post daily notes for absentees</Link>
              <Link href="/marks">Enter marks</Link>
              <Link href="/messages">Messages</Link>
              <Link href="/notices">Official notices</Link>
            </div>
          </Card>
        </div>
      </Loading>
    </>
  )
}
