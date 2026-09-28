'use client'
import { useState } from 'react'
import { Bar, Button, Card, Empty, Field, Loading, PageHead, Tabs } from '@/components/ui'
import { useMe, setting } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAsync } from '@/lib/hooks'
import { fetchClasses, useCurrentYear } from '@/lib/data'
import { classLabel, downloadCsv, q, todayISO } from '@/lib/util'

function ClassPicker({ value, onChange, classes }: any) {
  return <Field label="Class"><select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{(classes || []).map((c: any) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select></Field>
}

function AttendanceReport() {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const year = useCurrentYear()
  const today = todayISO(school.timezone)
  const low = Number(setting(school, 'low_attendance_threshold', 75))
  const classes = useAsync<any[]>(() => (year.data ? fetchClasses(year.data.id) : Promise.resolve([])), [year.data?.id])
  const [classId, setClassId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(today)
  const cid = classId || classes.data?.[0]?.id || ''
  const start = from || year.data?.start_date || today
  const d = useAsync<any[]>(() => (cid ? q(sb.rpc('attendance_summary', { p_class_id: cid, p_from: start, p_to: to })) : Promise.resolve([])), [cid, start, to])
  const label = classLabel(classes.data?.find((c) => c.id === cid))
  return (
    <>
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <ClassPicker value={cid} onChange={setClassId} classes={classes.data} />
          <Field label="From"><input className="input" type="date" value={start} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button disabled={!d.data?.length} onClick={() => downloadCsv(`attendance-${label}-${start}-to-${to}.csv`, [['Roll', 'Student', 'Present', 'Late', 'Absent', 'Leave', 'Attendance %'], ...(d.data || []).map((s) => [s.roll_no, s.full_name, s.present, s.late, s.absent, s.leave, s.pct])])}>Download CSV</Button>
        </div>
      </Card>
      <Loading loading={d.loading} error={d.error} hasData={!!d.data}>
        <Card flush>
          {d.data?.length === 0 && <Empty>No students.</Empty>}
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Roll</th><th>Student</th><th className="num">Present</th><th className="num">Late</th><th className="num">Absent</th><th className="num">Leave</th><th style={{ width: 220 }}>Attendance</th></tr></thead>
            <tbody>{(d.data || []).map((s) => <tr key={s.enrolment_id} className={s.pct != null && Number(s.pct) < low ? 'hl' : ''}><td className="small muted">{s.roll_no}</td><td><b>{s.full_name}</b></td><td className="num">{s.present}</td><td className="num">{s.late}</td><td className="num">{s.absent}</td><td className="num">{s.leave}</td><td><div className="row" style={{ flexWrap: 'nowrap' }}><div style={{ flex: 1 }}><Bar value={s.pct} low={low} /></div><b style={{ width: 52, textAlign: 'right' }}>{s.pct == null ? '–' : `${s.pct}%`}</b></div></td></tr>)}</tbody>
          </table></div>
        </Card>
      </Loading>
    </>
  )
}

function MarksReport() {
  const sb = supabaseBrowser()
  const year = useCurrentYear()
  const classes = useAsync<any[]>(() => (year.data ? fetchClasses(year.data.id) : Promise.resolve([])), [year.data?.id])
  const exams = useAsync<any[]>(() => (year.data ? q(sb.from('exams').select('id,name,term,status').eq('academic_year_id', year.data.id).order('created_at')) : Promise.resolve([])), [year.data?.id])
  const [classId, setClassId] = useState('')
  const [examId, setExamId] = useState('')
  const cid = classId || classes.data?.[0]?.id || ''
  const eid = examId || exams.data?.[0]?.id || ''
  const cls = classes.data?.find((c) => c.id === cid)
  const d = useAsync<any>(async () => {
    if (!cid || !eid || !cls) return null
    const [papers, enr] = await Promise.all([
      q<any[]>(sb.from('exam_subjects').select('id,max_marks,subject:subjects(name)').eq('exam_id', eid).eq('grade_level_id', cls.grade_level_id)),
      q<any[]>(sb.from('enrolments').select('id,roll_no,student:profiles(full_name)').eq('class_id', cid).eq('status', 'active').order('roll_no')),
    ])
    const marks = papers.length ? await q<any[]>(sb.from('marks').select('exam_subject_id,enrolment_id,marks_obtained,status').in('exam_subject_id', papers.map((p) => p.id)).in('enrolment_id', enr.map((e) => e.id))) : []
    papers.sort((a, b) => a.subject.name.localeCompare(b.subject.name))
    return { papers, enr, marks }
  }, [cid, eid])
  const val = (enrId: string, esId: string) => { const m = d.data.marks.find((x: any) => x.enrolment_id === enrId && x.exam_subject_id === esId); return m ? (m.marks_obtained == null ? 'AB' : m.marks_obtained) : '' }
  const total = (enrId: string) => d.data.papers.reduce((s: number, p: any) => { const v = val(enrId, p.id); return typeof v === 'number' || (v !== '' && v !== 'AB') ? s + Number(v) : s }, 0)
  const max = d.data ? d.data.papers.reduce((s: number, p: any) => s + Number(p.max_marks), 0) : 0
  return (
    <>
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <ClassPicker value={cid} onChange={setClassId} classes={classes.data} />
          <Field label="Exam"><select className="input" value={eid} onChange={(e) => setExamId(e.target.value)}>{(exams.data || []).map((e) => <option key={e.id} value={e.id}>{e.name} · {e.term}</option>)}</select></Field>
          <Button disabled={!d.data} onClick={() => downloadCsv(`marks-${classLabel(cls)}.csv`, [['Roll', 'Student', ...d.data.papers.map((p: any) => `${p.subject.name} (/${p.max_marks})`), `Total (/${max})`], ...d.data.enr.map((e: any) => [e.roll_no, e.student.full_name, ...d.data.papers.map((p: any) => val(e.id, p.id)), total(e.id)])])}>Download CSV</Button>
        </div>
      </Card>
      <Loading loading={d.loading} error={d.error} hasData={!!d.data || d.data === null}>
        {d.data === null && <Card><Empty>Choose a class and an exam.</Empty></Card>}
        {d.data && (
          <Card flush><div className="table-wrap"><table className="table">
            <thead><tr><th>Roll</th><th>Student</th>{d.data.papers.map((p: any) => <th key={p.id} className="num">{p.subject.name}<br /><span style={{ textTransform: 'none' }}>/ {p.max_marks}</span></th>)}<th className="num">Total / {max}</th></tr></thead>
            <tbody>{d.data.enr.map((e: any) => <tr key={e.id}><td className="small muted">{e.roll_no}</td><td><b>{e.student.full_name}</b></td>{d.data.papers.map((p: any) => <td key={p.id} className="num">{val(e.id, p.id) === '' ? <span className="muted">–</span> : val(e.id, p.id)}</td>)}<td className="num"><b>{total(e.id)}</b></td></tr>)}</tbody>
          </table></div></Card>
        )}
      </Loading>
    </>
  )
}

export default function Reports() {
  const [tab, setTab] = useState('att')
  return (
    <>
      <PageHead title="Reports" sub="Attendance and marks by class. Download as CSV to open in Excel." />
      <Tabs tabs={[['att', 'Attendance'], ['marks', 'Marks']]} value={tab} onChange={setTab} />
      {tab === 'att' ? <AttendanceReport /> : <MarksReport />}
    </>
  )
}
