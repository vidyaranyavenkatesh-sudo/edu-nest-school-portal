'use client'
import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, PageHead, StatusBadge, Tabs } from '@/components/ui'
import ReportCardView from '@/components/ReportCardView'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { fetchClasses, useCurrentYear, useGrades, useSubjects } from '@/lib/data'
import { classLabel, fmtDate, q } from '@/lib/util'

function ExamsTab() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const year = useCurrentYear()
  const grades = useGrades()
  const subjects = useSubjects()
  const [name, setName] = useState('')
  const [term, setTerm] = useState('Term 1')
  const [weight, setWeight] = useState('1')
  const [np, setNp] = useState<Record<string, { grade: string; subject: string; max: string }>>({})
  const { busy, run } = useAction()
  const data = useAsync<any>(async () => {
    if (!year.data) return null
    const exams = await q<any[]>(sb.from('exams').select('id,name,term,weight,status').eq('academic_year_id', year.data.id).order('created_at'))
    const papers = exams.length ? await q<any[]>(sb.from('exam_subjects').select('id,exam_id,grade_level_id,max_marks,grade:grade_levels(name,order_no),subject:subjects(name)').in('exam_id', exams.map((e) => e.id))) : []
    return { exams, papers }
  }, [year.data?.id])

  const create = () => run(async () => {
    await q(sb.from('exams').insert({ school_id: me.school_id, academic_year_id: year.data.id, name: name.trim(), term: term.trim(), weight: Number(weight) }))
    setName(''); data.reload()
  }, 'Exam created')
  const status = (id: string, s: string, msg: string) => run(async () => { await q(sb.rpc('set_exam_status', { p_exam_id: id, p_status: s })); data.reload() }, msg)
  const addPaper = (examId: string) => run(async () => {
    const p = np[examId]
    if (!p?.subject || !p?.max) throw new Error('Choose a subject and the maximum marks')
    const targets = p.grade === 'all' || !p.grade ? (grades.data || []).map((g) => g.id) : [p.grade]
    await q(sb.from('exam_subjects').upsert(targets.map((g) => ({ school_id: me.school_id, exam_id: examId, grade_level_id: g, subject_id: p.subject, max_marks: Number(p.max) })), { onConflict: 'exam_id,grade_level_id,subject_id' }))
    data.reload()
  }, 'Paper added')

  return (
    <>
      <Alert>Flow: <b>create the exam</b> and add its papers → teachers enter marks → <b>lock</b> (marks freeze) → <b>publish results</b> (students see their marks) → publish report cards under “Report cards”.</Alert>
      <Card title="New exam">
        <div className="grid c4">
          <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Unit Test 1" /></Field>
          <Field label="Term" hint="Report cards are made per term"><input className="input" value={term} onChange={(e) => setTerm(e.target.value)} /></Field>
          <Field label="Weight" hint="How much it counts, e.g. 1 or 2"><input className="input" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
          <div style={{ alignSelf: 'end' }}><Button variant="primary" loading={busy} disabled={!name.trim() || !term.trim() || !year.data} onClick={create}>Create exam</Button></div>
        </div>
        {!year.data && !year.loading && <Alert kind="warn">Set a current academic year first (School set-up).</Alert>}
      </Card>
      <Loading loading={data.loading} error={data.error} hasData={!!data.data}>
        {data.data?.exams.length === 0 && <Card><Empty>No exams yet this year.</Empty></Card>}
        {(data.data?.exams || []).map((e: any) => {
          const papers = data.data.papers.filter((p: any) => p.exam_id === e.id).sort((a: any, b: any) => (a.grade?.order_no - b.grade?.order_no) || a.subject.name.localeCompare(b.subject.name))
          const f = np[e.id] || { grade: 'all', subject: '', max: '' }
          return (
            <Card key={e.id}>
              <div className="row between">
                <div className="row"><h2 style={{ margin: 0 }}>{e.name}</h2><Badge>{e.term}</Badge><Badge>weight {e.weight}</Badge><StatusBadge status={e.status} /></div>
                <div className="row">
                  {e.status === 'draft' && <Confirm small variant="primary" message="Lock this exam? Teachers can no longer change marks." onConfirm={() => status(e.id, 'locked', 'Locked')}>Lock marks</Confirm>}
                  {e.status === 'locked' && <><Button small onClick={() => status(e.id, 'draft', 'Unlocked. Teachers can edit again.')}>Unlock</Button><Confirm small variant="primary" message="Publish results? Students will see their own marks." onConfirm={() => status(e.id, 'published', 'Results published')}>Publish results</Confirm></>}
                  {e.status === 'published' && <Button small onClick={() => status(e.id, 'locked', 'Results hidden from students')}>Hide results</Button>}
                  {e.status === 'draft' && papers.length === 0 && <Confirm small variant="danger" message="Delete this exam?" onConfirm={() => run(async () => { await q(sb.from('exams').delete().eq('id', e.id)); data.reload() })}>Delete</Confirm>}
                </div>
              </div>
              <table className="table" style={{ marginTop: 10 }}>
                <thead><tr><th>Grade</th><th>Subject</th><th className="num">Maximum marks</th><th></th></tr></thead>
                <tbody>
                  {papers.map((p: any) => (
                    <tr key={p.id}><td>Grade {p.grade?.name}</td><td>{p.subject.name}</td><td className="num">{p.max_marks}</td>
                      <td className="num">{e.status === 'draft' && <Confirm small variant="danger" message="Remove this paper and its marks?" onConfirm={() => run(async () => { await q(sb.from('exam_subjects').delete().eq('id', p.id)); data.reload() })}>Remove</Confirm>}</td></tr>
                  ))}
                  {papers.length === 0 && <tr><td colSpan={4} className="muted">No papers yet.</td></tr>}
                </tbody>
              </table>
              {e.status === 'draft' && (
                <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
                  <Field label="Grade"><select className="input" value={f.grade} onChange={(ev) => setNp({ ...np, [e.id]: { ...f, grade: ev.target.value } })}><option value="all">All grades</option>{(grades.data || []).map((g) => <option key={g.id} value={g.id}>Grade {g.name}</option>)}</select></Field>
                  <Field label="Subject"><select className="input" value={f.subject} onChange={(ev) => setNp({ ...np, [e.id]: { ...f, subject: ev.target.value } })}><option value="">Choose…</option>{(subjects.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                  <Field label="Max marks"><input className="input" style={{ width: 110 }} inputMode="decimal" value={f.max} onChange={(ev) => setNp({ ...np, [e.id]: { ...f, max: ev.target.value } })} /></Field>
                  <Button loading={busy} onClick={() => addPaper(e.id)}>Add paper</Button>
                </div>
              )}
            </Card>
          )
        })}
      </Loading>
    </>
  )
}

function CardsTab() {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const year = useCurrentYear()
  const classes = useAsync<any[]>(() => (year.data ? fetchClasses(year.data.id) : Promise.resolve([])), [year.data?.id])
  const [classId, setClassId] = useState('')
  const cid = classId || classes.data?.[0]?.id || ''
  const terms = useAsync<string[]>(async () => (year.data ? Array.from(new Set((await q<any[]>(sb.from('exams').select('term').eq('academic_year_id', year.data.id))).map((x) => x.term))) : []), [year.data?.id])
  const [term, setTerm] = useState('')
  const t = term || terms.data?.[0] || ''
  const [principal, setPrincipal] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<any>(null)
  const { busy, run } = useAction()

  const d = useAsync<any>(async () => {
    if (!cid || !t) return null
    const enr = await q<any[]>(sb.from('enrolments').select('id,roll_no,student:profiles(full_name)').eq('class_id', cid).neq('status', 'left').order('roll_no'))
    const ids = enr.map((e) => e.id)
    const [rem, cards] = ids.length ? await Promise.all([
      q<any[]>(sb.from('report_remarks').select('enrolment_id,teacher_remark,principal_remark').eq('term', t).in('enrolment_id', ids)),
      q<any[]>(sb.from('report_cards').select('id,enrolment_id,version,published_at,withdrawn_at,superseded_at').eq('term', t).in('enrolment_id', ids).order('version', { ascending: false })),
    ]) : [[], []]
    return { enr, rem: Object.fromEntries(rem.map((r) => [r.enrolment_id, r])) as Record<string, any>, cards }
  }, [cid, t])
  useEffect(() => { if (d.data) setPrincipal(Object.fromEntries(Object.entries(d.data.rem).map(([k, v]: any) => [k, v.principal_remark || '']))) }, [d.data])

  const saveRemark = (enrolmentId: string) => run(async () => {
    await q(sb.rpc('save_remarks', { p_enrolment_id: enrolmentId, p_term: t, p_teacher_remark: d.data.rem[enrolmentId]?.teacher_remark || '', p_principal_remark: principal[enrolmentId] || '' }))
    d.reload()
  }, 'Saved')
  const show = (enrolmentId: string) => run(async () => { setPreview(await q(sb.rpc('get_report_data', { p_enrolment_id: enrolmentId, p_term: t }))) })
  const publish = () => window.confirm(`Publish ${t} report cards for this whole class? Students are told at once. Publishing again later makes a corrected copy and keeps the old one.`) && run(async () => { const n = await q<number>(sb.rpc('publish_report_cards', { p_class_id: cid, p_term: t })); d.reload(); return n }, 'Report cards published')
  const withdraw = (id: string) => window.confirm('Withdraw this report card? The student will no longer see it.') && run(async () => { await q(sb.rpc('withdraw_report_card', { p_id: id })); d.reload() }, 'Withdrawn')

  return (
    <>
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Class"><select className="input" value={cid} onChange={(e) => setClassId(e.target.value)}>{(classes.data || []).map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select></Field>
          <Field label="Term"><select className="input" value={t} onChange={(e) => setTerm(e.target.value)}>{(terms.data || []).map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Button variant="primary" loading={busy} disabled={!cid || !t} onClick={publish}>Publish report cards for this class</Button>
        </div>
        {(terms.data || []).length === 0 && <Alert kind="warn">Create and lock an exam first.</Alert>}
      </Card>
      <Loading loading={d.loading} error={d.error} hasData={!!d.data}>
        {d.data && (
          <Card flush><div className="table-wrap"><table className="table">
            <thead><tr><th>Student</th><th>Class teacher's remark</th><th>Principal's remark</th><th>Published</th><th></th></tr></thead>
            <tbody>
              {d.data.enr.map((e: any) => {
                const latest = d.data.cards.find((c: any) => c.enrolment_id === e.id)
                return (
                  <tr key={e.id}>
                    <td><b>{e.roll_no}. {e.student.full_name}</b></td>
                    <td className="small">{d.data.rem[e.id]?.teacher_remark || <span className="muted">—</span>}</td>
                    <td><div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" value={principal[e.id] || ''} onChange={(ev) => setPrincipal({ ...principal, [e.id]: ev.target.value })} /><Button small loading={busy} onClick={() => saveRemark(e.id)}>Save</Button></div></td>
                    <td>{latest ? (latest.withdrawn_at ? <Badge kind="bad">Withdrawn</Badge> : <Badge kind="good">v{latest.version} · {fmtDate(String(latest.published_at).slice(0, 10))}</Badge>) : <span className="muted small">not yet</span>}</td>
                    <td className="num"><div className="row end"><Button small onClick={() => show(e.id)}>Preview</Button>{latest && !latest.withdrawn_at && <Button small variant="danger" onClick={() => withdraw(latest.id)}>Withdraw</Button>}</div></td>
                  </tr>
                )
              })}
            </tbody>
          </table></div></Card>
        )}
      </Loading>
      {preview && <Modal wide title="Report card preview (live)" onClose={() => setPreview(null)}><ReportCardView data={preview} tz={school.timezone} /></Modal>}
    </>
  )
}

export default function Exams() {
  const [tab, setTab] = useState('exams')
  return (
    <>
      <PageHead title="Exams & report cards" />
      <Tabs tabs={[['exams', 'Exams and papers'], ['cards', 'Report cards']]} value={tab} onChange={setTab} />
      {tab === 'exams' ? <ExamsTab /> : <CardsTab />}
    </>
  )
}
