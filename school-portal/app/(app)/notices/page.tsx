'use client'
import { useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHead, Tabs } from '@/components/ui'
import NoticesList from '@/components/NoticesList'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync, useDebounced } from '@/lib/hooks'
import { fetchClasses, useCurrentYear, useGrades } from '@/lib/data'
import { classLabel, fmtDateTime, q } from '@/lib/util'

function Compose({ onSent }: { onSent: () => void }) {
  const sb = supabaseBrowser()
  const year = useCurrentYear()
  const grades = useGrades()
  const classes = useAsync<any[]>(async () => (year.data ? fetchClasses(year.data.id) : []), [year.data?.id])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [type, setType] = useState('school')
  const [gradeIds, setGradeIds] = useState<string[]>([])
  const [classIds, setClassIds] = useState<string[]>([])
  const [people, setPeople] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const term = useDebounced(search, 250)
  const found = useAsync<any[]>(async () => (type === 'people' && term.length >= 2 ? q(sb.from('profiles').select('id,full_name,role,login_id').ilike('full_name', `%${term.replace(/[%,()]/g, ' ')}%`).eq('is_active', true).limit(15)) : []), [term, type])
  const { busy, run } = useAction()
  const toggle = (arr: string[], set: (v: string[]) => void, id: string) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  const send = () => run(async () => {
    if (!window.confirm('Send this official message now? It cannot be recalled.')) return
    await q(sb.rpc('send_notice', { p_title: title, p_body: body, p_audience_type: type, p_grade_ids: gradeIds, p_class_ids: classIds, p_profile_ids: Object.keys(people) }))
    setTitle(''); setBody(''); setGradeIds([]); setClassIds([]); setPeople({})
    onSent()
  }, 'Sent')

  return (
    <Card title="New official message">
      <div className="stack">
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Message"><textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <Field label="Send to">
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="school">Whole school (students and teachers)</option>
            <option value="grade">Whole grades (students and class teachers)</option>
            <option value="section">Particular sections (students and class teacher)</option>
            <option value="people">Chosen people</option>
          </select>
        </Field>
        {type === 'grade' && <div className="row">{(grades.data || []).map((g) => <label key={g.id} className="check"><input type="checkbox" checked={gradeIds.includes(g.id)} onChange={() => toggle(gradeIds, setGradeIds, g.id)} />Grade {g.name}</label>)}</div>}
        {type === 'section' && <div className="row">{(classes.data || []).map((c) => <label key={c.id} className="check"><input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggle(classIds, setClassIds, c.id)} />{classLabel(c)}</label>)}</div>}
        {type === 'people' && (
          <div>
            <input className="input" placeholder="Search a name (2+ letters)" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="row" style={{ marginTop: 8 }}>{Object.entries(people).map(([id, n]) => <Badge key={id} kind="accent">{n} <a style={{ cursor: 'pointer' }} onClick={() => { const p = { ...people }; delete p[id]; setPeople(p) }}>✕</a></Badge>)}</div>
            {(found.data || []).map((p) => <div key={p.id}><Button small className="ghost" onClick={() => setPeople({ ...people, [p.id]: p.full_name })}>+ {p.full_name} <span className="muted">({p.role}, {p.login_id})</span></Button></div>)}
          </div>
        )}
        <div><Button variant="primary" loading={busy} disabled={!title.trim() || !body.trim()} onClick={send}>Send message</Button></div>
      </div>
    </Card>
  )
}

function Sent() {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const d = useAsync<any>(async () => {
    const n = await q<any[]>(sb.from('notices').select('id,title,body,audience_type,sent_at').order('sent_at', { ascending: false }).limit(40))
    const s = await q<any[]>(sb.rpc('notice_stats'))
    return { n, stats: Object.fromEntries(s.map((x) => [x.notice_id, x])) as Record<string, any> }
  }, [])
  return (
    <Loading loading={d.loading} error={d.error} hasData={!!d.data}>
      {d.data?.n.length === 0 && <Card><Empty>Nothing sent yet.</Empty></Card>}
      {d.data?.n.map((n: any) => {
        const st = d.data.stats[n.id]
        return (
          <Card key={n.id}>
            <div className="row between"><b>{n.title}</b><span className="small muted">{fmtDateTime(n.sent_at, school.timezone)}</span></div>
            <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{n.body}</p>
            <div className="row"><Badge>{n.audience_type}</Badge>{st && <Badge kind="good">{st.read_count} of {st.total_count} have read it</Badge>}</div>
          </Card>
        )
      })}
    </Loading>
  )
}

export default function Notices() {
  const { me } = useMe()
  const [tab, setTab] = useState('sent')
  const [tick, setTick] = useState(0)
  if (me.role !== 'admin') return <><PageHead title="Official notices" sub="Messages from the school office" /><NoticesList /></>
  return (
    <>
      <PageHead title="Official notices" sub="One-way messages from the school office. Recipients cannot reply." />
      <Tabs tabs={[['sent', 'Sent'], ['new', 'Write a message'], ['inbox', 'My inbox']]} value={tab} onChange={setTab} />
      {tab === 'new' && <Compose onSent={() => { setTick(tick + 1); setTab('sent') }} />}
      {tab === 'sent' && <Sent key={tick} />}
      {tab === 'inbox' && <NoticesList />}
      {tab === 'new' && <Alert>Students see these under “Official notices”. They can read but not reply.</Alert>}
    </>
  )
}
