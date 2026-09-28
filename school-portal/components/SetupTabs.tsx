'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Badge, Button, Card, Empty, Field, Loading, Confirm } from './ui'
import { useMe, setting } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { fetchClasses, useCurrentYear, useGrades, usePeriods, useSubjects, useTeachers, useYears } from '@/lib/data'
import { classLabel, fmtDate, fmtTime, q } from '@/lib/util'

/* ------------------------------ academic years ------------------------------ */
export function YearsTab() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const years = useYears()
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const { busy, run } = useAction()
  const add = () => run(async () => {
    await q(sb.from('academic_years').insert({ school_id: me.school_id, name, start_date: start, end_date: end, is_current: (years.data || []).length === 0 }))
    setName(''); setStart(''); setEnd(''); years.reload()
  }, 'Year added')
  const makeCurrent = (id: string) => run(async () => {
    await q(sb.from('academic_years').update({ is_current: false }).eq('is_current', true))
    await q(sb.from('academic_years').update({ is_current: true }).eq('id', id))
    years.reload()
  }, 'Current year changed')
  return (
    <>
      <Card title="Academic years">
        <Loading loading={years.loading} error={years.error} hasData={!!years.data}>
          {years.data?.length === 0 && <Empty>Add your first academic year to begin.</Empty>}
          <table className="table"><tbody>
            {(years.data || []).map((y) => (
              <tr key={y.id}>
                <td><b>{y.name}</b> {y.is_current && <Badge kind="good">Current</Badge>}</td>
                <td>{fmtDate(y.start_date)} → {fmtDate(y.end_date)}</td>
                <td className="num"><div className="row end">
                  {!y.is_current && <Button small onClick={() => makeCurrent(y.id)}>Make current</Button>}
                  {!y.is_current && <Confirm small variant="danger" message="Delete this year? It only works if nothing uses it." onConfirm={() => run(async () => { await q(sb.from('academic_years').delete().eq('id', y.id)); years.reload() })}>Delete</Confirm>}
                </div></td>
              </tr>
            ))}
          </tbody></table>
        </Loading>
      </Card>
      <Card title="Add a year">
        <div className="grid c3">
          <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="2026-27" /></Field>
          <Field label="Starts"><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Ends"><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <div style={{ marginTop: 12 }}><Button variant="primary" loading={busy} disabled={!name || !start || !end} onClick={add}>Add year</Button></div>
      </Card>
    </>
  )
}

/* ------------------------------ grades (std) ------------------------------ */
export function GradesTab() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const grades = useGrades()
  const [name, setName] = useState('')
  const { busy, run } = useAction()
  const add = () => run(async () => {
    const next = Math.max(0, ...(grades.data || []).map((g) => g.order_no)) + 1
    await q(sb.from('grade_levels').insert({ school_id: me.school_id, name: name.trim(), order_no: next }))
    setName(''); grades.reload()
  })
  const swap = (a: any, b: any) => run(async () => {
    await q(sb.from('grade_levels').update({ order_no: -1 }).eq('id', a.id))
    await q(sb.from('grade_levels').update({ order_no: a.order_no }).eq('id', b.id))
    await q(sb.from('grade_levels').update({ order_no: b.order_no }).eq('id', a.id))
    grades.reload()
  })
  const list = grades.data || []
  return (
    <Card title="Grades (std)">
      <p className="muted">List them from the lowest to the highest. The order decides who moves up to which grade at year end.</p>
      <Loading loading={grades.loading} error={grades.error} hasData={!!grades.data}>
        <table className="table"><tbody>
          {list.map((g, i) => (
            <tr key={g.id}>
              <td className="num small muted" style={{ width: 40 }}>{i + 1}</td>
              <td><b>Grade {g.name}</b></td>
              <td className="num"><div className="row end">
                <Button small disabled={i === 0} onClick={() => swap(g, list[i - 1])}>↑</Button>
                <Button small disabled={i === list.length - 1} onClick={() => swap(g, list[i + 1])}>↓</Button>
                <Button small onClick={() => { const n = window.prompt('Grade name', g.name); if (n && n.trim()) run(async () => { await q(sb.from('grade_levels').update({ name: n.trim() }).eq('id', g.id)); grades.reload() }) }}>Rename</Button>
                <Confirm small variant="danger" message="Delete this grade?" onConfirm={() => run(async () => { await q(sb.from('grade_levels').delete().eq('id', g.id)); grades.reload() })}>Delete</Confirm>
              </div></td>
            </tr>
          ))}
        </tbody></table>
      </Loading>
      <div className="row" style={{ marginTop: 12 }}>
        <input className="input" style={{ maxWidth: 200 }} placeholder="e.g. 6, 7 or Nursery" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={add}>Add grade</Button>
      </div>
    </Card>
  )
}

/* ------------------------------ classes ------------------------------ */
export function ClassesTab() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const years = useYears()
  const grades = useGrades()
  const teachers = useTeachers()
  const [yearId, setYearId] = useState('')
  const [grade, setGrade] = useState('')
  const [section, setSection] = useState('A')
  const [teacher, setTeacher] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const { busy, run } = useAction()
  const yid = yearId || years.data?.find((y) => y.is_current)?.id || years.data?.[0]?.id || ''
  const classes = useAsync<any[]>(() => (yid ? fetchClasses(yid) : Promise.resolve([])), [yid])
  const add = () => run(async () => {
    await q(sb.from('classes').insert({ school_id: me.school_id, academic_year_id: yid, grade_level_id: grade, section: section.trim() || 'A', class_teacher_id: teacher || null }))
    classes.reload()
  }, 'Class added')
  const setCT = (id: string, t: string) => run(async () => { await q(sb.from('classes').update({ class_teacher_id: t || null }).eq('id', id)); classes.reload() }, 'Saved')
  const clone = () => run(async () => { const n = await q<number>(sb.rpc('clone_year_setup', { p_from_year: copyFrom, p_to_year: yid })); classes.reload(); if (n === 0) throw new Error('Nothing new to copy: those classes already exist.') }, 'Classes, subject teachers and timetable copied')
  return (
    <>
      <Card title="Classes" actions={<select className="input" value={yid} onChange={(e) => setYearId(e.target.value)}>{(years.data || []).map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : ''}</option>)}</select>}>
        <Loading loading={classes.loading} error={classes.error} hasData={!!classes.data}>
          {classes.data?.length === 0 && <Empty>No classes in this year yet.</Empty>}
          <div className="table-wrap"><table className="table"><tbody>
            {(classes.data || []).map((c) => (
              <tr key={c.id}>
                <td><b>Class {classLabel(c)}</b></td>
                <td><select className="input" value={c.class_teacher_id || ''} onChange={(e) => setCT(c.id, e.target.value)}><option value="">No class teacher</option>{(teachers.data || []).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></td>
                <td className="num"><Confirm small variant="danger" message="Delete this class? Only works if it has no students or records." onConfirm={() => run(async () => { await q(sb.from('classes').delete().eq('id', c.id)); classes.reload() })}>Delete</Confirm></td>
              </tr>
            ))}
          </tbody></table></div>
        </Loading>
      </Card>
      <Card title="Add a class">
        <div className="grid c4">
          <Field label="Grade"><select className="input" value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">Choose…</option>{(grades.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          <Field label="Section"><input className="input" value={section} onChange={(e) => setSection(e.target.value)} /></Field>
          <Field label="Class teacher"><select className="input" value={teacher} onChange={(e) => setTeacher(e.target.value)}><option value="">— later —</option>{(teachers.data || []).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field>
          <div style={{ alignSelf: 'end' }}><Button variant="primary" loading={busy} disabled={!grade || !yid} onClick={add}>Add class</Button></div>
        </div>
      </Card>
      <Card title="Copy from another year">
        <p className="muted">Saves time for a new year: copies classes, class teachers, subject teachers and the timetable into the year selected above.</p>
        <div className="row">
          <select className="input" style={{ maxWidth: 240 }} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}><option value="">Copy from…</option>{(years.data || []).filter((y) => y.id !== yid).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select>
          <Button loading={busy} disabled={!copyFrom || !yid} onClick={clone}>Copy</Button>
        </div>
      </Card>
    </>
  )
}

/* ------------------------------ subjects ------------------------------ */
export function SubjectsTab() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const subjects = useSubjects()
  const [name, setName] = useState('')
  const { busy, run } = useAction()
  return (
    <Card title="Subjects">
      <Loading loading={subjects.loading} error={subjects.error} hasData={!!subjects.data}>
        {subjects.data?.length === 0 && <Empty>No subjects yet.</Empty>}
        <table className="table"><tbody>
          {(subjects.data || []).map((s) => (
            <tr key={s.id}><td><b>{s.name}</b></td><td className="num"><div className="row end">
              <Button small onClick={() => { const n = window.prompt('Subject name', s.name); if (n && n.trim()) run(async () => { await q(sb.from('subjects').update({ name: n.trim() }).eq('id', s.id)); subjects.reload() }) }}>Rename</Button>
              <Confirm small variant="danger" message="Delete this subject?" onConfirm={() => run(async () => { await q(sb.from('subjects').delete().eq('id', s.id)); subjects.reload() })}>Delete</Confirm>
            </div></td></tr>
          ))}
        </tbody></table>
      </Loading>
      <div className="row" style={{ marginTop: 12 }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="e.g. Mathematics" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && run(async () => { await q(sb.from('subjects').insert({ school_id: me.school_id, name: name.trim() })); setName(''); subjects.reload() })} />
        <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => run(async () => { await q(sb.from('subjects').insert({ school_id: me.school_id, name: name.trim() })); setName(''); subjects.reload() })}>Add subject</Button>
      </div>
    </Card>
  )
}

/* ------------------------------ periods ------------------------------ */
export function PeriodsTab() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const periods = usePeriods()
  const [label, setLabel] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('09:45')
  const { busy, run } = useAction()
  const add = () => run(async () => {
    const n = Math.max(0, ...(periods.data || []).map((p) => p.number)) + 1
    await q(sb.from('periods').insert({ school_id: me.school_id, number: n, label: label || null, start_time: start, end_time: end }))
    setLabel(''); periods.reload()
  })
  const edit = (p: any) => {
    const s = window.prompt('Start time (HH:MM, 24-hour)', p.start_time.slice(0, 5)); if (!s) return
    const e = window.prompt('End time (HH:MM, 24-hour)', p.end_time.slice(0, 5)); if (!e) return
    run(async () => { await q(sb.from('periods').update({ start_time: s, end_time: e }).eq('id', p.id)); periods.reload() })
  }
  return (
    <Card title="School periods">
      <p className="muted">The bell schedule. The timetable and period-wise attendance use these.</p>
      <Loading loading={periods.loading} error={periods.error} hasData={!!periods.data}>
        <table className="table"><tbody>
          {(periods.data || []).map((p) => (
            <tr key={p.id}><td><b>Period {p.number}</b> {p.label && <span className="muted">({p.label})</span>}</td><td>{fmtTime(p.start_time)} – {fmtTime(p.end_time)}</td>
              <td className="num"><div className="row end"><Button small onClick={() => edit(p)}>Change times</Button><Confirm small variant="danger" message="Delete this period? Its timetable boxes will go too." onConfirm={() => run(async () => { await q(sb.from('periods').delete().eq('id', p.id)); periods.reload() })}>Delete</Confirm></div></td></tr>
          ))}
        </tbody></table>
      </Loading>
      <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <Field label="Label (optional)"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Lunch" /></Field>
        <Field label="Start"><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End"><input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Button variant="primary" loading={busy} onClick={add}>Add period</Button>
      </div>
    </Card>
  )
}

/* ------------------------------ who teaches what ------------------------------ */
export function TeachingTab() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const year = useCurrentYear()
  const subjects = useSubjects()
  const teachers = useTeachers()
  const classes = useAsync<any[]>(() => (year.data ? fetchClasses(year.data.id) : Promise.resolve([])), [year.data?.id])
  const [classId, setClassId] = useState('')
  const cid = classId || classes.data?.[0]?.id || ''
  const assigns = useAsync<any[]>(() => (cid ? q(sb.from('teaching_assignments').select('id,subject_id,teacher_id').eq('class_id', cid)) : Promise.resolve([])), [cid])
  const { run } = useAction()
  const set = (subjectId: string, teacherId: string) => run(async () => {
    if (!teacherId) await q(sb.from('teaching_assignments').delete().eq('class_id', cid).eq('subject_id', subjectId))
    else await q(sb.from('teaching_assignments').upsert({ school_id: me.school_id, class_id: cid, subject_id: subjectId, teacher_id: teacherId }, { onConflict: 'class_id,subject_id' }))
    assigns.reload()
  }, 'Saved')
  return (
    <Card title="Who teaches what" actions={<select className="input" value={cid} onChange={(e) => setClassId(e.target.value)}>{(classes.data || []).map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select>}>
      <p className="muted">Teachers can only take attendance, post notes and enter marks for the classes and subjects assigned to them here (class teachers can do so for all subjects of their class).</p>
      {(classes.data || []).length === 0 && <Empty>Add classes first.</Empty>}
      <table className="table"><tbody>
        {(subjects.data || []).map((s) => {
          const a = (assigns.data || []).find((x) => x.subject_id === s.id)
          return (
            <tr key={s.id}><td><b>{s.name}</b></td>
              <td><select className="input" value={a?.teacher_id || ''} onChange={(e) => set(s.id, e.target.value)}><option value="">Not taught</option>{(teachers.data || []).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></td></tr>
          )
        })}
      </tbody></table>
    </Card>
  )
}

/* ------------------------------ grade scale ------------------------------ */
const STANDARD_SCALE = [[90, 'A1', 10], [80, 'A2', 9], [70, 'B1', 8], [60, 'B2', 7], [50, 'C1', 6], [40, 'C2', 5], [33, 'D', 4], [0, 'E', 0]]
export function ScaleTab() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const scale = useAsync<any[]>(() => q(sb.from('grade_scales').select('id,min_percent,grade,points').order('min_percent', { ascending: false })), [])
  const [min, setMin] = useState('')
  const [grade, setGrade] = useState('')
  const [points, setPoints] = useState('')
  const { busy, run } = useAction()
  const add = () => run(async () => { await q(sb.from('grade_scales').insert({ school_id: me.school_id, min_percent: Number(min), grade, points: points === '' ? null : Number(points) })); setMin(''); setGrade(''); setPoints(''); scale.reload() })
  const standard = () => run(async () => {
    await q(sb.from('grade_scales').delete().eq('school_id', me.school_id))
    await q(sb.from('grade_scales').insert(STANDARD_SCALE.map(([m, g, p]) => ({ school_id: me.school_id, min_percent: m, grade: g, points: p }))))
    scale.reload()
  }, 'Standard scale loaded')
  return (
    <Card title="Grade scale" actions={<Confirm small message="This replaces the current scale." onConfirm={standard}>Load a standard 8-grade scale</Confirm>}>
      <p className="muted">A percentage gets the grade with the highest “from %” that it reaches. Include a row from 0.</p>
      <Loading loading={scale.loading} error={scale.error} hasData={!!scale.data}>
        {scale.data?.length === 0 && <Alert kind="warn">No scale yet. Report cards need one to show grades.</Alert>}
        <table className="table"><thead><tr><th>From %</th><th>Grade</th><th>Grade points</th><th></th></tr></thead><tbody>
          {(scale.data || []).map((r) => <tr key={r.id}><td>{r.min_percent}</td><td><b>{r.grade}</b></td><td>{r.points ?? '–'}</td><td className="num"><Confirm small variant="danger" message="Delete this row?" onConfirm={() => run(async () => { await q(sb.from('grade_scales').delete().eq('id', r.id)); scale.reload() })}>Delete</Confirm></td></tr>)}
        </tbody></table>
      </Loading>
      <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <Field label="From %"><input className="input" style={{ width: 100 }} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
        <Field label="Grade"><input className="input" style={{ width: 100 }} value={grade} onChange={(e) => setGrade(e.target.value)} /></Field>
        <Field label="Points"><input className="input" style={{ width: 100 }} inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} /></Field>
        <Button variant="primary" loading={busy} disabled={min === '' || !grade} onClick={add}>Add row</Button>
      </div>
    </Card>
  )
}

/* ------------------------------ school settings ------------------------------ */
const DEFAULTS: any = {
  attendance_mode: 'day', attendance_lock_days: 7, late_counts_as_attended: true, low_attendance_threshold: 75,
  student_chat_enabled: true, quiet_hours: { enabled: false, start: '21:00', end: '06:00' }, max_upload_mb: 10,
  max_extra_periods_per_day: 2, substitution_rank: ['subject', 'grade'], lockout_attempts: 5, lockout_minutes: 15,
  promotion_reverse_days: 14, min_attendance_for_promotion: 75, pass_percent: 33,
}
export function SettingsTab() {
  const { school, me } = useMe()
  const sb = supabaseBrowser()
  const router = useRouter()
  const [s, setS] = useState<any>(() => ({ ...DEFAULTS, ...(school.settings || {}), quiet_hours: { ...DEFAULTS.quiet_hours, ...(school.settings?.quiet_hours || {}) } }))
  const { busy, run } = useAction()
  const num = (k: string) => (e: any) => setS({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) })
  const save = () => run(async () => {
    const clean = { ...s }
    for (const k of ['attendance_lock_days', 'low_attendance_threshold', 'max_upload_mb', 'max_extra_periods_per_day', 'lockout_attempts', 'lockout_minutes', 'promotion_reverse_days', 'min_attendance_for_promotion', 'pass_percent']) {
      if (clean[k] === '' || Number.isNaN(Number(clean[k]))) throw new Error('Please fill in every number')
    }
    await q(sb.from('schools').update({ settings: clean }).eq('id', me.school_id))
    router.refresh()
  }, 'Settings saved')
  return (
    <>
      <Card title="Attendance">
        <div className="grid c2">
          <Field label="How is attendance marked?"><select className="input" value={s.attendance_mode} onChange={(e) => setS({ ...s, attendance_mode: e.target.value })}><option value="day">Once a day</option><option value="period">Every period</option></select></Field>
          <Field label="Days before earlier attendance locks" hint="After this, only the office can change it"><input className="input" inputMode="numeric" value={s.attendance_lock_days} onChange={num('attendance_lock_days')} /></Field>
          <Field label="Alert when attendance falls below (%)"><input className="input" inputMode="numeric" value={s.low_attendance_threshold} onChange={num('low_attendance_threshold')} /></Field>
          <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={s.late_counts_as_attended} onChange={(e) => setS({ ...s, late_counts_as_attended: e.target.checked })} />“Late” counts as attended</label>
        </div>
        {s.attendance_mode !== (school.settings?.attendance_mode || 'day') && <Alert kind="warn">Changing this mid-year mixes the two kinds of records. It is best done at the start of a year.</Alert>}
      </Card>
      <Card title="Chat">
        <div className="grid c2">
          <label className="check"><input type="checkbox" checked={s.student_chat_enabled} onChange={(e) => setS({ ...s, student_chat_enabled: e.target.checked })} />Students may chat with classmates</label>
          <label className="check"><input type="checkbox" checked={s.quiet_hours.enabled} onChange={(e) => setS({ ...s, quiet_hours: { ...s.quiet_hours, enabled: e.target.checked } })} />Pause student-to-student chat at night</label>
          <Field label="Pause from"><input className="input" type="time" value={s.quiet_hours.start} onChange={(e) => setS({ ...s, quiet_hours: { ...s.quiet_hours, start: e.target.value } })} /></Field>
          <Field label="Until"><input className="input" type="time" value={s.quiet_hours.end} onChange={(e) => setS({ ...s, quiet_hours: { ...s.quiet_hours, end: e.target.value } })} /></Field>
          <Field label="Largest file (MB)" hint="The storage system itself allows up to 10 MB"><input className="input" inputMode="numeric" value={s.max_upload_mb} onChange={num('max_upload_mb')} /></Field>
        </div>
      </Card>
      <Card title="Substitutions">
        <div className="grid c2">
          <Field label="Most extra periods a teacher covers in a day"><input className="input" inputMode="numeric" value={s.max_extra_periods_per_day} onChange={num('max_extra_periods_per_day')} /></Field>
          <Field label="Prefer a teacher who teaches…"><select className="input" value={s.substitution_rank[0]} onChange={(e) => setS({ ...s, substitution_rank: e.target.value === 'subject' ? ['subject', 'grade'] : ['grade', 'subject'] })}><option value="subject">the same subject first, then the same grade</option><option value="grade">the same grade first, then the same subject</option></select></Field>
        </div>
      </Card>
      <Card title="Year-end grade (std) changes">
        <div className="grid c3">
          <Field label="Minimum attendance to move up (%)"><input className="input" inputMode="numeric" value={s.min_attendance_for_promotion} onChange={num('min_attendance_for_promotion')} /></Field>
          <Field label="Pass mark (%)"><input className="input" inputMode="numeric" value={s.pass_percent} onChange={num('pass_percent')} /></Field>
          <Field label="Days a run can be reversed"><input className="input" inputMode="numeric" value={s.promotion_reverse_days} onChange={num('promotion_reverse_days')} /></Field>
        </div>
      </Card>
      <Card title="Login safety">
        <div className="grid c2">
          <Field label="Wrong passwords before locking"><input className="input" inputMode="numeric" value={s.lockout_attempts} onChange={num('lockout_attempts')} /></Field>
          <Field label="Locked for (minutes)"><input className="input" inputMode="numeric" value={s.lockout_minutes} onChange={num('lockout_minutes')} /></Field>
        </div>
      </Card>
      <Button variant="primary" loading={busy} onClick={save}>Save settings</Button>
    </>
  )
}
