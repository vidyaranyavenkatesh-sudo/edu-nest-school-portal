'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Alert, Badge, Bar, Button, Card, Empty, Field, Loading, PageHead, StatusBadge, Tabs } from '@/components/ui'
import { useMe, setting } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { fetchClasses, useMyClasses } from '@/lib/data'
import { classLabel, fmtDate, q, todayISO } from '@/lib/util'

export default function ClassDesk() {
  const { me, school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const low = Number(setting(school, 'low_attendance_threshold', 75))
  const my = useMyClasses()
  const [classId, setClassId] = useState('')
  const [tab, setTab] = useState('overview')
  const { busy, run } = useAction()

  const deskClasses = (my.data?.classes || []).filter((c) => me.role === 'admin' || c.class_teacher_id === me.id)
  useEffect(() => { if (!classId && deskClasses.length) setClassId(deskClasses[0].id) }, [my.data]) // eslint-disable-line
  const cls = deskClasses.find((c) => c.id === classId)

  // ---- overview ----
  const [from, setFrom] = useState('')
  const start = from || my.data?.year?.start_date || today
  const summary = useAsync<any[]>(() => (classId && tab === 'overview' ? q(sb.rpc('attendance_summary', { p_class_id: classId, p_from: start, p_to: today })) : Promise.resolve([])), [classId, start, tab])

  // ---- remarks ----
  const terms = useAsync<string[]>(async () => {
    if (!my.data?.year) return []
    const ex = await q<any[]>(sb.from('exams').select('term').eq('academic_year_id', my.data.year.id))
    return Array.from(new Set(ex.map((e) => e.term)))
  }, [my.data?.year?.id])
  const [term, setTerm] = useState('')
  useEffect(() => { if (!term && terms.data?.length) setTerm(terms.data[0]) }, [terms.data, term])
  const remarks = useAsync<any>(async () => {
    if (!classId || tab !== 'remarks' || !term) return null
    const enr = await q<any[]>(sb.from('enrolments').select('id,roll_no,student:profiles(full_name)').eq('class_id', classId).eq('status', 'active').order('roll_no'))
    const rem = enr.length ? await q<any[]>(sb.from('report_remarks').select('enrolment_id,teacher_remark').eq('term', term).in('enrolment_id', enr.map((e) => e.id))) : []
    return { enr, rem: Object.fromEntries(rem.map((r) => [r.enrolment_id, r.teacher_remark || ''])) as Record<string, string> }
  }, [classId, tab, term])
  const [texts, setTexts] = useState<Record<string, string>>({})
  useEffect(() => { if (remarks.data) setTexts(remarks.data.rem) }, [remarks.data])
  const saveRemark = (enrolmentId: string) => run(async () => { await q(sb.rpc('save_remarks', { p_enrolment_id: enrolmentId, p_term: term, p_teacher_remark: texts[enrolmentId] || '' })) }, 'Saved')

  // ---- grade (std) ----
  const gc = useAsync<any>(async () => {
    if (!classId || tab !== 'grade' || !my.data?.year) return null
    const [enr, allClasses, reqs, runs] = await Promise.all([
      q<any[]>(sb.from('enrolments').select('id,roll_no,student:profiles(full_name)').eq('class_id', classId).eq('status', 'active').order('roll_no')),
      fetchClasses(my.data.year.id),
      q<any[]>(sb.from('grade_change_requests').select('id,reason,status,created_at,to_class:classes!grade_change_requests_to_class_id_fkey(section,grade:grade_levels(name)),enrolment:enrolments(student:profiles(full_name))').eq('from_class_id', classId).order('created_at', { ascending: false }).limit(20)),
      q<any[]>(sb.from('promotion_runs').select('id,status,to_year_id,rule').eq('status', 'proposed')),
    ])
    let items: any[] = [], targets: any[] = [], names: Record<string, string> = {}
    if (runs[0]) {
      items = await q<any[]>(sb.from('promotion_items').select('id,student_id,action,to_class_id,needs_review,note').eq('run_id', runs[0].id).eq('from_class_id', classId))
      targets = await fetchClasses(runs[0].to_year_id)
      const ids = items.map((i) => i.student_id)
      const p = ids.length ? await q<any[]>(sb.from('profiles').select('id,full_name').in('id', ids)) : []
      names = Object.fromEntries(p.map((x) => [x.id, x.full_name]))
    }
    return { enr, allClasses, reqs, run: runs[0] || null, items, targets, names }
  }, [classId, tab, my.data?.year?.id])
  const [reqEnr, setReqEnr] = useState('')
  const [reqTo, setReqTo] = useState('')
  const [reqWhy, setReqWhy] = useState('')
  const request = () => run(async () => { await q(sb.rpc('request_grade_change', { p_enrolment_id: reqEnr, p_to_class_id: reqTo, p_reason: reqWhy })); setReqWhy(''); gc.reload() }, 'Sent to the school office for approval')
  const editItem = (id: string, action: string, to: string | null) => run(async () => { await q(sb.rpc('update_promotion_item', { p_item_id: id, p_action: action, p_to_class_id: to })); gc.reload() }, 'Updated')

  // ---- chat & safety ----
  const reports = useAsync<any[]>(async () => (tab === 'safety' ? q(sb.from('message_reports').select('id,reason,message_body,status,created_at,reporter:profiles!message_reports_reported_by_fkey(full_name)').order('created_at', { ascending: false }).limit(30)) : []), [tab])
  const setChat = (on: boolean) => run(async () => { await q(sb.rpc('set_class_chat', { p_class: classId, p_enabled: on })); my.reload() }, on ? 'Class chat is on' : 'Class chat is off')
  const resolve = (id: string, status: string) => run(async () => { await q(sb.rpc('resolve_report', { p_id: id, p_status: status })); reports.reload() })

  return (
    <>
      <PageHead title="Class teacher desk" sub="Your class at a glance" />
      <Loading loading={my.loading} error={my.error} hasData={!!my.data}>
        {deskClasses.length === 0 && <Card><Empty>You are not the class teacher of any class this year.</Empty></Card>}
        {deskClasses.length > 0 && (
          <>
            <div className="row" style={{ marginBottom: 14 }}>
              <Field label="Class"><select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>{deskClasses.map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select></Field>
            </div>
            <Tabs tabs={[['overview', 'Attendance'], ['remarks', 'Report card remarks'], ['grade', 'Grade (std) changes'], ['safety', 'Chat & safety']]} value={tab} onChange={setTab} />

            {tab === 'overview' && (
              <Loading loading={summary.loading} error={summary.error} hasData={!!summary.data}>
                <Card flush>
                  <div className="row between" style={{ padding: 16 }}>
                    <span className="muted">From <input className="input" type="date" style={{ width: 160, display: 'inline-block' }} value={start} onChange={(e) => setFrom(e.target.value)} /> to today</span>
                    <Link className="btn" href={`/attendance?class=${classId}&date=${new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10)}`}>Correct yesterday's attendance</Link>
                  </div>
                  <div className="table-wrap"><table className="table">
                    <thead><tr><th>Roll</th><th>Student</th><th className="num">Present</th><th className="num">Late</th><th className="num">Absent</th><th className="num">Leave</th><th style={{ width: 200 }}>Attendance</th></tr></thead>
                    <tbody>
                      {(summary.data || []).map((s) => (
                        <tr key={s.enrolment_id} className={s.pct != null && Number(s.pct) < low ? 'hl' : ''}>
                          <td className="small muted">{s.roll_no}</td><td><b>{s.full_name}</b></td>
                          <td className="num">{s.present}</td><td className="num">{s.late}</td><td className="num">{s.absent}</td><td className="num">{s.leave}</td>
                          <td><div className="row" style={{ flexWrap: 'nowrap' }}><div style={{ flex: 1 }}><Bar value={s.pct} low={low} /></div><b style={{ width: 52, textAlign: 'right' }}>{s.pct == null ? '–' : `${s.pct}%`}</b></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                  {summary.data?.length === 0 && <Empty>No students.</Empty>}
                </Card>
                <p className="small muted">Highlighted rows are below the school minimum of {low}%.</p>
              </Loading>
            )}

            {tab === 'remarks' && (
              <>
                {(terms.data || []).length === 0 && <Alert kind="warn">Terms appear here once the school office has created exams for this year.</Alert>}
                <Field label="Term"><select className="input" style={{ maxWidth: 240 }} value={term} onChange={(e) => setTerm(e.target.value)}>{(terms.data || []).map((t) => <option key={t}>{t}</option>)}</select></Field>
                <div style={{ height: 12 }} />
                <Loading loading={remarks.loading} error={remarks.error} hasData={!!remarks.data}>
                  {(remarks.data?.enr || []).map((e: any) => (
                    <Card key={e.id}>
                      <div className="row between"><b>{e.roll_no}. {e.student.full_name}</b><Button small loading={busy} onClick={() => saveRemark(e.id)}>Save</Button></div>
                      <textarea className="input" style={{ marginTop: 8 }} rows={2} placeholder="Your remark for the report card" value={texts[e.id] || ''} onChange={(ev) => setTexts({ ...texts, [e.id]: ev.target.value })} />
                    </Card>
                  ))}
                </Loading>
              </>
            )}

            {tab === 'grade' && (
              <Loading loading={gc.loading} error={gc.error} hasData={!!gc.data}>
                {gc.data && (
                  <>
                    <Card title="Year-end grade (std) plan for your class">
                      {!gc.data.run && <Empty>The school office has not started a year-end run yet.</Empty>}
                      {gc.data.run && (
                        <>
                          <p className="muted">The system proposed what happens to each student. Change any that need it; the school office approves the whole plan.</p>
                          <div className="table-wrap"><table className="table"><tbody>
                            {gc.data.items.map((i: any) => (
                              <tr key={i.id} className={i.needs_review ? 'hl' : ''}>
                                <td><b>{gc.data.names[i.student_id]}</b>{i.needs_review && <> <Badge kind="warn">check</Badge></>}<br /><span className="small muted">{i.note}</span></td>
                                <td>
                                  <select className="input" value={i.action} onChange={(e) => editItem(i.id, e.target.value, e.target.value === 'pass_out' ? null : i.to_class_id)}>
                                    <option value="promote">Move up</option><option value="hold_back">Stay in same grade</option><option value="move">Move to another grade</option><option value="pass_out">Leaves the school</option>
                                  </select>
                                </td>
                                <td>
                                  {i.action !== 'pass_out' && (
                                    <select className="input" value={i.to_class_id || ''} onChange={(e) => editItem(i.id, i.action, e.target.value)}>
                                      <option value="">Choose class…</option>{gc.data.targets.map((c: any) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}
                                    </select>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody></table></div>
                        </>
                      )}
                    </Card>
                    <Card title="Propose a change for one student now">
                      <p className="muted">For example moving a student to another section this year. The school office decides.</p>
                      <div className="grid c3">
                        <Field label="Student"><select className="input" value={reqEnr} onChange={(e) => setReqEnr(e.target.value)}><option value="">Choose…</option>{gc.data.enr.map((e: any) => <option key={e.id} value={e.id}>{e.student.full_name}</option>)}</select></Field>
                        <Field label="Move to"><select className="input" value={reqTo} onChange={(e) => setReqTo(e.target.value)}><option value="">Choose…</option>{gc.data.allClasses.filter((c: any) => c.id !== classId).map((c: any) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select></Field>
                        <Field label="Reason"><input className="input" value={reqWhy} onChange={(e) => setReqWhy(e.target.value)} /></Field>
                      </div>
                      <div style={{ marginTop: 12 }}><Button variant="primary" loading={busy} disabled={!reqEnr || !reqTo} onClick={request}>Send to school office</Button></div>
                      {gc.data.reqs.length > 0 && <table className="table" style={{ marginTop: 14 }}><tbody>{gc.data.reqs.map((r: any) => <tr key={r.id}><td>{r.enrolment?.student?.full_name} → Class {classLabel(r.to_class)}<br /><span className="small muted">{r.reason}</span></td><td className="num"><StatusBadge status={r.status} /></td></tr>)}</tbody></table>}
                    </Card>
                  </>
                )}
              </Loading>
            )}

            {tab === 'safety' && (
              <>
                <Card title="Student chat for this class">
                  <p className="muted">When off, students of this class cannot start or continue chats with each other. Chats with teachers are not affected.</p>
                  <div className="row"><Badge kind={cls?.chat_enabled ? 'good' : 'bad'}>{cls?.chat_enabled ? 'On' : 'Off'}</Badge>
                    <Button loading={busy} onClick={() => setChat(!cls?.chat_enabled)}>{cls?.chat_enabled ? 'Switch off' : 'Switch on'}</Button></div>
                </Card>
                <Card title="Messages reported by your students">
                  <Loading loading={reports.loading} error={reports.error} hasData={!!reports.data}>
                    {reports.data?.length === 0 && <Empty>No reports.</Empty>}
                    {(reports.data || []).map((r) => (
                      <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                        <div className="row between"><span><b>{r.reporter?.full_name}</b> reported a message · {fmtDate(String(r.created_at).slice(0, 10))}</span><StatusBadge status={r.status} /></div>
                        <div className="muted small">Reason: {r.reason || '—'}</div>
                        <blockquote style={{ margin: '6px 0', paddingLeft: 10, borderLeft: '3px solid var(--line)' }}>{r.message_body || '(attachment)'}</blockquote>
                        {r.status === 'open' && <div className="row"><Button small onClick={() => resolve(r.id, 'reviewed')}>Mark reviewed</Button><Button small onClick={() => resolve(r.id, 'dismissed')}>Dismiss</Button></div>}
                      </div>
                    ))}
                  </Loading>
                </Card>
              </>
            )}
          </>
        )}
      </Loading>
    </>
  )
}
