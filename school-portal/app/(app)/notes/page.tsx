'use client'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHead } from '@/components/ui'
import { useMe, setting } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { useMyClasses, useSubjects } from '@/lib/data'
import { classLabel, fmtDate, fmtSize, q, todayISO, uuid } from '@/lib/util'
import { openFile, uploadFile } from '@/lib/files'
import { toast, toastError } from '@/lib/toast'

export default function Notes() {
  const { me, school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const my = useMyClasses()
  const subjects = useSubjects()
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [date, setDate] = useState(today)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [edit, setEdit] = useState<any>(null)
  const { busy, run } = useAction()
  const maxMb = Number(setting(school, 'max_upload_mb', 10))

  useEffect(() => { if (!classId && my.data?.classes.length) setClassId(my.data.classes[0].id) }, [my.data, classId])

  // subjects I may post for in this class
  const allowed = (() => {
    if (!my.data || !subjects.data) return []
    if (me.role === 'admin' || my.data.ownClassIds.includes(classId)) return subjects.data
    const ids = new Set(my.data.assignments.filter((a) => a.class_id === classId).map((a) => a.subject_id))
    return subjects.data.filter((s) => ids.has(s.id))
  })()
  useEffect(() => {
    if (allowed.find((s: any) => s.id === subjectId)) return
    // prefer a subject I teach in this class
    const mine = my.data?.assignments.find((a) => a.class_id === classId && a.teacher_id === me.id && allowed.some((s: any) => s.id === a.subject_id))
    setSubjectId(mine?.subject_id || allowed[0]?.id || '')
  }, [classId, subjects.data, my.data]) // eslint-disable-line

  const absent = useAsync<number>(async () => {
    if (!classId) return 0
    const r = await sb.from('attendance').select('enrolment_id,enrolments!inner(class_id)', { count: 'exact', head: true }).eq('status', 'absent').eq('date', date).eq('enrolments.class_id', classId)
    return r.count || 0
  }, [classId, date])

  const list = useAsync<any[]>(() => {
    let query = sb.from('daily_notes').select('id,title,body,note_date,withdrawn,class_id,subject_id,created_by,class:classes(id,section,grade:grade_levels(name)),subject:subjects(name),note_files(id,file_name,storage_path,size_bytes)').order('note_date', { ascending: false }).order('created_at', { ascending: false }).limit(40)
    if (me.role !== 'admin') query = query.eq('created_by', me.id)
    return q(query)
  }, [])

  const post = () =>
    run(async () => {
      if (!classId || !subjectId) throw new Error('Choose a class and subject')
      if (!title.trim()) throw new Error('Give the note a title')
      const big = files.find((f) => f.size > maxMb * 1024 * 1024)
      if (big) throw new Error(`${big.name} is larger than ${maxMb} MB`)
      const id = uuid()
      await q(sb.from('daily_notes').insert({ id, school_id: me.school_id, class_id: classId, subject_id: subjectId, note_date: date, title: title.trim(), body, created_by: me.id }))
      for (const f of files) {
        const up = await uploadFile('notes', me.school_id, id, f)
        await q(sb.from('note_files').insert({ school_id: me.school_id, note_id: id, storage_path: up.path, file_name: up.name, size_bytes: up.size }))
      }
      setTitle(''); setBody(''); setFiles([])
      list.reload()
    }, 'Note posted. Students who were absent can see it now.')

  const toggleWithdraw = (n: any) => run(async () => { await q(sb.from('daily_notes').update({ withdrawn: !n.withdrawn }).eq('id', n.id)); list.reload() }, n.withdrawn ? 'Note is visible again' : 'Note withdrawn')
  const remove = (n: any) => window.confirm('Delete this note and its files for good?') && run(async () => {
    const paths = n.note_files.map((f: any) => f.storage_path)
    if (paths.length) await sb.storage.from('notes').remove(paths)
    await q(sb.from('daily_notes').delete().eq('id', n.id))
    list.reload()
  }, 'Deleted')
  const saveEdit = () => run(async () => { await q(sb.from('daily_notes').update({ title: edit.title, body: edit.body }).eq('id', edit.id)); setEdit(null); list.reload() }, 'Saved')

  return (
    <>
      <PageHead title="Daily notes" sub="Post what you taught today. Anyone who was absent is told and can read it straight away." />
      <Loading loading={my.loading} error={my.error} hasData={!!my.data}>
        {my.data?.classes.length === 0 ? <Card><Empty>You are not assigned to any class yet.</Empty></Card> : (
          <Card title="New note">
            <div className="grid c3">
              <Field label="Class"><select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>{my.data?.classes.map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select></Field>
              <Field label="Subject"><select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>{allowed.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Date of the lesson"><input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /></Field>
            </div>
            <div className="stack" style={{ marginTop: 12 }}>
              <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chapter 3: Fractions, exercise 3.2" /></Field>
              <Field label="Notes"><textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="What was taught, homework, links…" /></Field>
              <div className="row">
                <label className="btn" style={{ cursor: 'pointer' }}>📎 Attach files<input type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])]); e.currentTarget.value = '' }} /></label>
                {files.map((f, i) => <Badge key={i} kind="accent">{f.name} ({fmtSize(f.size)}) <a style={{ cursor: 'pointer' }} onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</a></Badge>)}
                <span className="small muted">PDF, images, Word, Excel or PowerPoint · up to {maxMb} MB each</span>
              </div>
              <div className="row between">
                <span className="small muted">{absent.data ? `${absent.data} student${absent.data > 1 ? 's were' : ' was'} marked absent on ${fmtDate(date)} and will be notified.` : 'No one is marked absent for this day yet. Students marked absent later will still see this note.'}</span>
                <Button variant="primary" loading={busy} onClick={post}>Post note</Button>
              </div>
            </div>
          </Card>
        )}
      </Loading>
      <h2 style={{ marginTop: 24 }}>{me.role === 'admin' ? 'Recent notes' : 'My recent notes'}</h2>
      <Loading loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data?.length === 0 && <Card><Empty>Nothing posted yet.</Empty></Card>}
        {(list.data || []).map((n) => (
          <Card key={n.id}>
            <div className="row between">
              <div className="row"><Badge kind="accent">{n.subject?.name}</Badge><Badge>Class {classLabel(n.class)}</Badge><b>{n.title}</b>{n.withdrawn && <Badge kind="warn">Withdrawn</Badge>}</div>
              <span className="small muted">{fmtDate(n.note_date)}</span>
            </div>
            {n.body && <p style={{ whiteSpace: 'pre-wrap', margin: '10px 0' }}>{n.body}</p>}
            <div className="row">{n.note_files.map((f: any) => <Button key={f.id} small onClick={() => openFile('notes', f.storage_path).catch(toastError)}>📎 {f.file_name}</Button>)}</div>
            {(n.created_by === me.id || me.role === 'admin') && (
              <div className="row" style={{ marginTop: 10 }}>
                <Button small onClick={() => setEdit({ ...n })}>Edit</Button>
                <Button small onClick={() => toggleWithdraw(n)}>{n.withdrawn ? 'Show again' : 'Withdraw'}</Button>
                <Button small variant="danger" onClick={() => remove(n)}>Delete</Button>
              </div>
            )}
          </Card>
        ))}
      </Loading>
      {edit && (
        <Modal title="Edit note" onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={saveEdit}>Save</Button></>}>
          <div className="stack">
            <Field label="Title"><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="input" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  )
}
