'use client'
import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHead, StatusBadge } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { useMyClasses } from '@/lib/data'
import { classLabel, q } from '@/lib/util'

export default function Marks() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const my = useMyClasses()
  const [examId, setExamId] = useState('')
  const [paper, setPaper] = useState<{ es: any; cls: any } | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const inputs = useRef<Record<number, HTMLInputElement | null>>({})
  const { busy, run } = useAction()

  const exams = useAsync<any[]>(async () => (my.data?.year ? q(sb.from('exams').select('id,name,term,weight,status').eq('academic_year_id', my.data.year.id).order('created_at', { ascending: false })) : []), [my.data?.year?.id])
  useEffect(() => { if (!examId && exams.data?.length) setExamId(exams.data[0].id) }, [exams.data, examId])
  const exam = exams.data?.find((e) => e.id === examId)

  const papers = useAsync<any[]>(async () => (examId ? q(sb.from('exam_subjects').select('id,max_marks,grade_level_id,subject_id,subject:subjects(name)').eq('exam_id', examId)) : []), [examId])
  // papers I can enter: class of that grade + my teaching assignment for the subject
  const options: { es: any; cls: any }[] = []
  ;(papers.data || []).forEach((es) => {
    (my.data?.classes || []).filter((c) => c.grade_level_id === es.grade_level_id).forEach((c) => {
      const ok = me.role === 'admin' || my.data!.assignments.some((a) => a.class_id === c.id && a.subject_id === es.subject_id)
      if (ok) options.push({ es, cls: c })
    })
  })
  options.sort((a, b) => (a.cls.grade?.order_no - b.cls.grade?.order_no) || a.cls.section.localeCompare(b.cls.section) || a.es.subject.name.localeCompare(b.es.subject.name))

  const sheet = useAsync<any>(async () => {
    if (!paper) return null
    const enr = await q<any[]>(sb.from('enrolments').select('id,roll_no,student:profiles(full_name)').eq('class_id', paper.cls.id).eq('status', 'active').order('roll_no'))
    const m = await q<any[]>(sb.from('marks').select('enrolment_id,marks_obtained,status').eq('exam_subject_id', paper.es.id))
    return { enr, marks: m }
  }, [paper?.es.id, paper?.cls.id])
  useEffect(() => {
    if (!sheet.data) return
    const v: Record<string, string> = {}
    sheet.data.marks.forEach((m: any) => (v[m.enrolment_id] = m.marks_obtained == null ? '' : String(m.marks_obtained)))
    setVals(v)
  }, [sheet.data])

  const locked = exam && exam.status !== 'draft'
  const rows = () => sheet.data.enr.map((e: any) => ({ enrolment_id: e.id, marks_obtained: vals[e.id] === '' || vals[e.id] == null ? null : Number(vals[e.id]) }))
  const bad = paper && sheet.data ? sheet.data.enr.find((e: any) => vals[e.id] !== undefined && vals[e.id] !== '' && (isNaN(Number(vals[e.id])) || Number(vals[e.id]) < 0 || Number(vals[e.id]) > Number(paper.es.max_marks))) : null
  const save = (submit: boolean) => run(async () => {
    await q(sb.rpc('save_marks', { p_exam_subject_id: paper!.es.id, p_class_id: paper!.cls.id, p_rows: rows(), p_submit: submit }))
    sheet.reload()
  }, submit ? 'Marks submitted' : 'Draft saved')

  const status = sheet.data?.marks.length ? (sheet.data.marks.every((m: any) => m.status === 'locked') ? 'locked' : sheet.data.marks.every((m: any) => m.status !== 'draft') ? 'submitted' : 'draft') : 'draft'
  return (
    <>
      <PageHead title="Marks entry" sub="Choose an exam, then the class and subject you teach" />
      <Loading loading={my.loading || exams.loading} error={my.error || exams.error} hasData={!!exams.data}>
        {exams.data?.length === 0 && <Card><Empty>No exams have been set up for this year yet. The school office creates exams under “Exams & report cards”.</Empty></Card>}
        {(exams.data?.length || 0) > 0 && (
          <div className="grid c2">
            <Card title="1. Exam">
              <Field label="Exam"><select className="input" value={examId} onChange={(e) => { setExamId(e.target.value); setPaper(null) }}>{exams.data!.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.term}</option>)}</select></Field>
              {exam && <p style={{ marginTop: 10, marginBottom: 0 }}><StatusBadge status={exam.status} /> <span className="small muted">weight {exam.weight}</span></p>}
              {locked && <Alert kind="warn">This exam is locked. Marks can be viewed but not changed. Ask the school office to unlock it if a correction is needed.</Alert>}
            </Card>
            <Card title="2. Class and subject">
              {options.length === 0 && <Empty>No papers of this exam belong to a class and subject you teach.</Empty>}
              <div className="stack">
                {options.map((o) => (
                  <button key={o.es.id + o.cls.id} className={`btn ${paper?.es.id === o.es.id && paper?.cls.id === o.cls.id ? 'primary' : ''}`} style={{ justifyContent: 'space-between' }} onClick={() => setPaper(o)}>
                    <span>Class {classLabel(o.cls)} · {o.es.subject.name}</span><span className="small">out of {o.es.max_marks}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        )}
        {paper && (
          <Loading loading={sheet.loading} error={sheet.error} hasData={!!sheet.data}>
            {sheet.data && (
              <Card flush>
                <div className="row between" style={{ padding: 16 }}>
                  <div className="row"><b>Class {classLabel(paper.cls)} · {paper.es.subject.name}</b><Badge>out of {paper.es.max_marks}</Badge><StatusBadge status={locked ? 'locked' : status} /></div>
                  {!locked && (
                    <div className="row">
                      <Button loading={busy} disabled={!!bad} onClick={() => save(false)}>Save draft</Button>
                      <Button variant="primary" loading={busy} disabled={!!bad} onClick={() => window.confirm('Submit these marks? You can still change them until the office locks the exam.') && save(true)}>Submit</Button>
                    </div>
                  )}
                </div>
                {bad && <div style={{ padding: '0 16px' }}><Alert kind="bad">{bad.student.full_name}: marks must be a number from 0 to {paper.es.max_marks}. Leave blank if absent.</Alert></div>}
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Roll</th><th>Student</th><th className="num">Marks (blank = absent)</th></tr></thead>
                  <tbody>
                    {sheet.data.enr.map((e: any, i: number) => (
                      <tr key={e.id}>
                        <td className="small muted">{e.roll_no}</td>
                        <td><b>{e.student.full_name}</b></td>
                        <td className="num">
                          <input className="input" style={{ width: 110, textAlign: 'right' }} inputMode="decimal" disabled={!!locked} value={vals[e.id] ?? ''}
                            ref={(el) => { inputs.current[i] = el }}
                            onChange={(ev) => setVals({ ...vals, [e.id]: ev.target.value })}
                            onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); inputs.current[i + 1]?.focus() } }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </Card>
            )}
          </Loading>
        )}
      </Loading>
    </>
  )
}
