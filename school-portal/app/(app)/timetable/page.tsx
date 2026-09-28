'use client'
import { useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, PageHead, Tabs } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { fetchClasses, useCurrentYear, usePeriods, useSubjects, useTeachers } from '@/lib/data'
import { addDays, classLabel, cx, fmtDate, fmtTime, q, startOfWeek, todayISO, WEEKDAYS } from '@/lib/util'

const DAYS = [1, 2, 3, 4, 5, 6]

/** One teacher's week, including substitution duties and periods covered by someone else. */
function TeacherWeek({ teacherId }: { teacherId: string }) {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const [week, setWeek] = useState(startOfWeek(today))
  const year = useCurrentYear()
  const periods = usePeriods()
  const d = useAsync<any>(async () => {
    if (!year.data) return null
    const [entries, subs, names] = await Promise.all([
      q<any[]>(sb.from('timetable_entries').select('id,weekday,period_id,class:classes(id,section,grade:grade_levels(name)),subject:subjects(name)').eq('teacher_id', teacherId).eq('academic_year_id', year.data.id)),
      q<any[]>(sb.from('substitutions').select('timetable_entry_id,date,status,substitute_id,absent_teacher_id,period_id,entry:timetable_entries(subject:subjects(name),class:classes(id,section,grade:grade_levels(name)))').or(`substitute_id.eq.${teacherId},absent_teacher_id.eq.${teacherId}`).gte('date', week).lte('date', addDays(week, 6))),
      q<any[]>(sb.from('profiles').select('id,full_name').eq('role', 'teacher')),
    ])
    return { entries, subs, names: Object.fromEntries(names.map((n) => [n.id, n.full_name])) as Record<string, string> }
  }, [year.data?.id, teacherId, week])
  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <b>Week of {fmtDate(week)}</b>
        <div className="row"><Button small onClick={() => setWeek(addDays(week, -7))}>← Previous</Button><Button small onClick={() => setWeek(startOfWeek(today))}>This week</Button><Button small onClick={() => setWeek(addDays(week, 7))}>Next →</Button></div>
      </div>
      <Loading loading={d.loading || periods.loading} error={d.error} hasData={!!d.data}>
        {d.data && (
          <Card flush><div className="table-wrap" style={{ padding: 10 }}>
            <table className="tt">
              <thead><tr><th></th>{DAYS.map((w) => <th key={w}>{WEEKDAYS[w].slice(0, 3)}<br /><span className="muted">{addDays(week, w - 1).slice(8)}</span></th>)}</tr></thead>
              <tbody>
                {(periods.data || []).map((p) => (
                  <tr key={p.id}>
                    <th>{p.number}<br /><span className="muted" style={{ textTransform: 'none' }}>{fmtTime(p.start_time)}</span></th>
                    {DAYS.map((w) => {
                      const date = addDays(week, w - 1)
                      const e = d.data.entries.find((x: any) => x.weekday === w && x.period_id === p.id)
                      const extra = d.data.subs.find((s: any) => s.substitute_id === teacherId && s.date === date && s.period_id === p.id && ['approved', 'accepted'].includes(s.status))
                      const covered = e && d.data.subs.find((s: any) => s.timetable_entry_id === e.id && s.date === date && s.absent_teacher_id === teacherId)
                      if (extra) return <td key={w} className={cx('sub', date === today && 'today')}><b>Substitution</b><div className="who">Class {classLabel(extra.entry?.class)} · {extra.entry?.subject?.name}<br />{extra.status === 'approved' ? '(waiting to accept)' : ''}</div></td>
                      if (!e) return <td key={w} className="empty">–</td>
                      return (
                        <td key={w} className={cx(covered && 'sub', date === today && 'today')}>
                          <b>Class {classLabel(e.class)}</b><div className="who">{e.subject.name}</div>
                          {covered && <div className="who">{covered.status === 'self_study' ? 'Self study' : covered.substitute_id ? `Covered by ${d.data.names[covered.substitute_id]}` : 'Cover not arranged'}</div>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div></Card>
        )}
      </Loading>
    </>
  )
}

/** Admin: build the weekly timetable of a class. Clashes are refused by the database. */
function Builder() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const year = useCurrentYear()
  const periods = usePeriods()
  const subjects = useSubjects()
  const teachers = useTeachers()
  const [classId, setClassId] = useState('')
  const [cell, setCell] = useState<any>(null)
  const { busy, run } = useAction()
  const classes = useAsync<any[]>(async () => (year.data ? fetchClasses(year.data.id) : []), [year.data?.id])
  const cid = classId || classes.data?.[0]?.id || ''
  const d = useAsync<any>(async () => {
    if (!cid) return null
    const [entries, assigns] = await Promise.all([
      q<any[]>(sb.from('timetable_entries').select('id,weekday,period_id,subject_id,teacher_id,subject:subjects(name)').eq('class_id', cid)),
      q<any[]>(sb.from('teaching_assignments').select('subject_id,teacher_id').eq('class_id', cid)),
    ])
    return { entries, assigns }
  }, [cid])
  const tname = Object.fromEntries((teachers.data || []).map((t) => [t.id, t.full_name]))

  const openCell = (weekday: number, period: any) => {
    const e = d.data.entries.find((x: any) => x.weekday === weekday && x.period_id === period.id)
    setCell({ weekday, period, id: e?.id, subject_id: e?.subject_id || '', teacher_id: e?.teacher_id || '' })
  }
  const pickSubject = (sid: string) => {
    const a = d.data.assigns.find((x: any) => x.subject_id === sid)
    setCell({ ...cell, subject_id: sid, teacher_id: a?.teacher_id || cell.teacher_id })
  }
  const save = () => run(async () => {
    if (!cell.subject_id || !cell.teacher_id) throw new Error('Choose a subject and a teacher')
    if (cell.id) await q(sb.from('timetable_entries').update({ subject_id: cell.subject_id, teacher_id: cell.teacher_id }).eq('id', cell.id))
    else await q(sb.from('timetable_entries').insert({ school_id: me.school_id, class_id: cid, subject_id: cell.subject_id, teacher_id: cell.teacher_id, weekday: cell.weekday, period_id: cell.period.id }))
    setCell(null); d.reload()
  }, 'Saved')
  const clear = () => run(async () => { await q(sb.from('timetable_entries').delete().eq('id', cell.id)); setCell(null); d.reload() }, 'Cleared')

  return (
    <>
      <Field label="Class" className="">
        <select className="input" style={{ maxWidth: 260 }} value={cid} onChange={(e) => setClassId(e.target.value)}>{(classes.data || []).map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select>
      </Field>
      <p className="muted small">Click a box to set the subject and teacher. The system refuses a teacher who already has another class in that period.</p>
      <Loading loading={d.loading || periods.loading} error={d.error} hasData={!!d.data}>
        {(periods.data || []).length === 0 && <Alert kind="warn">Add the school periods first under School set-up → Periods.</Alert>}
        {d.data && (periods.data || []).length > 0 && (
          <Card flush><div className="table-wrap" style={{ padding: 10 }}>
            <table className="tt">
              <thead><tr><th></th>{DAYS.map((w) => <th key={w}>{WEEKDAYS[w].slice(0, 3)}</th>)}</tr></thead>
              <tbody>
                {periods.data!.map((p) => (
                  <tr key={p.id}>
                    <th>{p.number}<br /><span className="muted" style={{ textTransform: 'none' }}>{fmtTime(p.start_time)}</span></th>
                    {DAYS.map((w) => {
                      const e = d.data.entries.find((x: any) => x.weekday === w && x.period_id === p.id)
                      return <td key={w} className={cx('clickable', !e && 'empty')} onClick={() => openCell(w, p)}>{e ? <><b>{e.subject.name}</b><div className="who">{tname[e.teacher_id] || '—'}</div></> : '+'}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div></Card>
        )}
      </Loading>
      {cell && (
        <Modal title={`${WEEKDAYS[cell.weekday]} · Period ${cell.period.number}`} onClose={() => setCell(null)}
          footer={<>{cell.id && <Button variant="danger" loading={busy} onClick={clear}>Clear</Button>}<Button onClick={() => setCell(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
          <div className="stack">
            <Field label="Subject"><select className="input" value={cell.subject_id} onChange={(e) => pickSubject(e.target.value)}><option value="">Choose…</option>{(subjects.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Teacher" hint="Filled in from the class's subject teacher when there is one"><select className="input" value={cell.teacher_id} onChange={(e) => setCell({ ...cell, teacher_id: e.target.value })}><option value="">Choose…</option>{(teachers.data || []).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field>
          </div>
        </Modal>
      )}
    </>
  )
}

export default function Timetable() {
  const { me } = useMe()
  const teachers = useTeachers()
  const [tab, setTab] = useState('build')
  const [teacher, setTeacher] = useState('')
  if (me.role !== 'admin') return <><PageHead title="My timetable" sub="Your week, with substitutions" /><TeacherWeek teacherId={me.id} /></>
  const tid = teacher || teachers.data?.[0]?.id || ''
  return (
    <>
      <PageHead title="Timetable" sub="Build class timetables and see any teacher's week" />
      <Tabs tabs={[['build', 'Build by class'], ['teacher', 'View by teacher']]} value={tab} onChange={setTab} />
      {tab === 'build' ? <Builder /> : (
        <>
          <Field label="Teacher"><select className="input" style={{ maxWidth: 260 }} value={tid} onChange={(e) => setTeacher(e.target.value)}>{(teachers.data || []).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field>
          <div style={{ height: 12 }} />
          {tid && <TeacherWeek teacherId={tid} />}
          {!tid && <Empty>No teachers yet.</Empty>}
        </>
      )}
    </>
  )
}
