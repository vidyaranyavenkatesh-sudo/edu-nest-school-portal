'use client'
import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Confirm, Empty, Field, Loading, PageHead, StatusBadge, Tabs } from '@/components/ui'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { fetchClasses, useYears } from '@/lib/data'
import { addDays, classLabel, fmtDate, q, todayISO } from '@/lib/util'
import { useMe } from '@/lib/profile'

const ACTIONS: Record<string, string> = { promote: 'Move up', hold_back: 'Stay in same grade', move: 'Move to another grade', pass_out: 'Leaves the school' }

function Runs() {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const years = useYears()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rule, setRule] = useState('all')
  const [runId, setRunId] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [limit, setLimit] = useState(60)
  const [disableOn, setDisableOn] = useState(addDays(todayISO(school.timezone), 30))
  const { busy, run } = useAction()

  const runs = useAsync<any[]>(() => q(sb.from('promotion_runs').select('id,from_year_id,to_year_id,rule,status,created_at,applied_at').order('created_at', { ascending: false })), [])
  useEffect(() => { if (!runId && runs.data?.length) setRunId(runs.data[0].id) }, [runs.data, runId])
  const cur = runs.data?.find((r) => r.id === runId)
  const yname = (id: string) => years.data?.find((y) => y.id === id)?.name || ''
  useEffect(() => { if (years.data?.length) { const c = years.data.find((y) => y.is_current); if (!from && c) setFrom(c.id) } }, [years.data]) // eslint-disable-line

  const detail = useAsync<any>(async () => {
    if (!cur) return null
    const [fromClasses, toClasses] = await Promise.all([fetchClasses(cur.from_year_id), fetchClasses(cur.to_year_id)])
    let query = sb.from('promotion_items').select('id,student_id,from_class_id,action,to_class_id,needs_review,note').eq('run_id', cur.id).order('from_class_id').limit(limit)
    if (classFilter) query = query.eq('from_class_id', classFilter)
    const items = await q<any[]>(query)
    const ids = items.map((i) => i.student_id)
    const names = ids.length ? await q<any[]>(sb.from('profiles').select('id,full_name').in('id', ids)) : []
    const counts: Record<string, number> = {}
    for (const a of Object.keys(ACTIONS)) counts[a] = (await sb.from('promotion_items').select('id', { count: 'exact', head: true }).eq('run_id', cur.id).eq('action', a)).count || 0
    const review = (await sb.from('promotion_items').select('id', { count: 'exact', head: true }).eq('run_id', cur.id).eq('needs_review', true)).count || 0
    return { fromClasses, toClasses, items, names: Object.fromEntries(names.map((n) => [n.id, n.full_name])) as Record<string, string>, counts, review }
  }, [cur?.id, cur?.status, classFilter, limit])

  const create = () => run(async () => { const id = await q<string>(sb.rpc('create_promotion_run', { p_from_year: from, p_to_year: to, p_rule: rule })); await runs.reload(); setRunId(id) }, 'Plan created. Review it below.')
  const edit = (id: string, action: string, toClass: string | null) => run(async () => { await q(sb.rpc('update_promotion_item', { p_item_id: id, p_action: action, p_to_class_id: toClass })); detail.reload() })
  const confirmAll = () => run(async () => { const n = await q<number>(sb.rpc('confirm_promotion_items', { p_run_id: cur.id })); detail.reload(); return n }, 'Suggestions confirmed')
  const approve = () => run(async () => { await q(sb.rpc('approve_promotion_run', { p_run_id: cur.id })); runs.reload() }, 'Approved. Nothing has changed yet.')
  const apply = () => window.confirm('Apply now? Every student moves at once, the new academic year becomes the current one, and students who leave are scheduled to be switched off.') && run(async () => { await q(sb.rpc('apply_promotion_run', { p_run_id: cur.id, p_passout_disable_on: disableOn || null })); runs.reload() }, 'Done. The new year is now current.')
  const reverse = () => window.confirm('Undo this whole run and go back to the old year?') && run(async () => { await q(sb.rpc('reverse_promotion_run', { p_run_id: cur.id })); runs.reload() }, 'Reversed')

  return (
    <>
      <Alert>
        <b>How it works:</b> 1) Create the new academic year and its classes under School set-up (use “Copy from another year”). 2) Create a plan below: the system proposes what happens to every student. 3) Class teachers and you adjust anything. 4) Approve. 5) Apply. Nothing changes until step 5, and it can be reversed for a while afterwards.
      </Alert>
      <Card title="Start a year-end plan">
        <div className="grid c4">
          <Field label="From year"><select className="input" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose…</option>{(years.data || []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></Field>
          <Field label="To year"><select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{(years.data || []).filter((y) => y.id !== from).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></Field>
          <Field label="Who moves up?"><select className="input" value={rule} onChange={(e) => setRule(e.target.value)}><option value="all">Everyone moves up</option><option value="by_rule">Only those meeting attendance and pass mark</option></select></Field>
          <div style={{ alignSelf: 'end' }}><Button variant="primary" loading={busy} disabled={!from || !to} onClick={create}>Create plan</Button></div>
        </div>
      </Card>
      <Loading loading={runs.loading} error={runs.error} hasData={!!runs.data}>
        {runs.data?.length === 0 && <Card><Empty>No plans yet.</Empty></Card>}
        {(runs.data || []).length > 0 && (
          <Field label="Plan"><select className="input" style={{ maxWidth: 380 }} value={runId} onChange={(e) => { setRunId(e.target.value); setClassFilter(''); setLimit(60) }}>{runs.data!.map((r) => <option key={r.id} value={r.id}>{yname(r.from_year_id)} → {yname(r.to_year_id)} · {r.status}</option>)}</select></Field>
        )}
        {cur && (
          <Loading loading={detail.loading} error={detail.error} hasData={!!detail.data}>
            {detail.data && (
              <>
                <Card title={`${yname(cur.from_year_id)} → ${yname(cur.to_year_id)}`} actions={<StatusBadge status={cur.status} />}>
                  <div className="row">{Object.entries(ACTIONS).map(([k, l]) => <Badge key={k} kind={k === 'pass_out' ? 'warn' : k === 'hold_back' ? 'bad' : 'good'}>{l}: {detail.data.counts[k]}</Badge>)}{detail.data.review > 0 && <Badge kind="warn">{detail.data.review} need a decision</Badge>}</div>
                  <div className="row" style={{ marginTop: 14 }}>
                    {cur.status === 'proposed' && <>
                      {detail.data.review > 0 && <Button loading={busy} onClick={confirmAll}>Accept all suggestions</Button>}
                      <Button variant="primary" loading={busy} disabled={detail.data.review > 0} onClick={approve}>Approve plan</Button>
                    </>}
                    {cur.status === 'approved' && <>
                      <Field label="Switch off logins of students who leave on"><input className="input" type="date" value={disableOn} onChange={(e) => setDisableOn(e.target.value)} /></Field>
                      <Button variant="primary" loading={busy} style={{ alignSelf: 'flex-end' }} onClick={apply}>Apply now</Button>
                    </>}
                    {cur.status === 'applied' && <><span className="muted">Applied {fmtDate(String(cur.applied_at).slice(0, 10))}.</span><Button variant="danger" loading={busy} onClick={reverse}>Reverse</Button></>}
                  </div>
                </Card>
                <Card flush>
                  <div className="row" style={{ padding: 16 }}>
                    <select className="input" style={{ maxWidth: 220 }} value={classFilter} onChange={(e) => { setClassFilter(e.target.value); setLimit(60) }}><option value="">All classes</option>{detail.data.fromClasses.map((c: any) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select>
                  </div>
                  <div className="table-wrap"><table className="table">
                    <thead><tr><th>Student</th><th>Now in</th><th>What happens</th><th>Next year's class</th></tr></thead>
                    <tbody>
                      {detail.data.items.map((i: any) => {
                        const editable = cur.status === 'proposed'
                        const fc = detail.data.fromClasses.find((c: any) => c.id === i.from_class_id)
                        return (
                          <tr key={i.id} className={i.needs_review ? 'hl' : ''}>
                            <td><b>{detail.data.names[i.student_id]}</b>{i.note && <div className="small muted">{i.note}</div>}</td>
                            <td>{classLabel(fc)}</td>
                            <td>{editable ? <select className="input" value={i.action} onChange={(e) => edit(i.id, e.target.value, e.target.value === 'pass_out' ? null : i.to_class_id)}>{Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : ACTIONS[i.action]}</td>
                            <td>{i.action === 'pass_out' ? <span className="muted">—</span> : editable ? <select className="input" value={i.to_class_id || ''} onChange={(e) => edit(i.id, i.action, e.target.value)}><option value="">Choose…</option>{detail.data.toClasses.map((c: any) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select> : classLabel(detail.data.toClasses.find((c: any) => c.id === i.to_class_id))}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table></div>
                  {detail.data.items.length >= limit && <div className="row" style={{ justifyContent: 'center', padding: 12 }}><Button onClick={() => setLimit(limit + 60)}>Show more</Button></div>}
                </Card>
              </>
            )}
          </Loading>
        )}
      </Loading>
    </>
  )
}

function Requests() {
  const sb = supabaseBrowser()
  const { busy, run } = useAction()
  const d = useAsync<any[]>(() => q(sb.from('grade_change_requests').select('id,reason,status,created_at,from_class:classes!grade_change_requests_from_class_id_fkey(section,grade:grade_levels(name)),to_class:classes!grade_change_requests_to_class_id_fkey(section,grade:grade_levels(name)),enrolment:enrolments(student:profiles(full_name))').order('created_at', { ascending: false }).limit(50)), [])
  const decide = (id: string, ok: boolean) => run(async () => { await q(sb.rpc('decide_grade_change', { p_id: id, p_approve: ok })); d.reload() }, ok ? 'Approved. The student has moved.' : 'Declined')
  return (
    <Loading loading={d.loading} error={d.error} hasData={!!d.data}>
      {d.data?.length === 0 && <Card><Empty>No requests from class teachers.</Empty></Card>}
      {(d.data || []).map((r) => (
        <Card key={r.id}>
          <div className="row between">
            <div><b>{r.enrolment?.student?.full_name}</b>: Class {classLabel(r.from_class)} → Class {classLabel(r.to_class)}<br /><span className="muted">{r.reason || 'No reason given'}</span></div>
            <div className="row">{r.status === 'pending' ? <><Button variant="primary" loading={busy} onClick={() => decide(r.id, true)}>Approve</Button><Confirm variant="danger" message="Decline this request?" onConfirm={() => decide(r.id, false)}>Decline</Confirm></> : <StatusBadge status={r.status} />}</div>
          </div>
        </Card>
      ))}
    </Loading>
  )
}

export default function Promotions() {
  const [tab, setTab] = useState('runs')
  return (
    <>
      <PageHead title="Grade (std) changes" sub="Move students up at year end, or change one student's class during the year" />
      <Tabs tabs={[['runs', 'Year-end plan'], ['requests', 'Requests from class teachers']]} value={tab} onChange={setTab} />
      {tab === 'runs' ? <Runs /> : <Requests />}
    </>
  )
}
