'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Empty, Field, Modal, Spinner } from './ui'
import { useMe, setting } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAsync, useAction, useDebounced } from '@/lib/hooks'
import { classLabel, cx, fmtDateTime, fmtSize, initials, q } from '@/lib/util'
import { uploadFile, openFile } from '@/lib/files'
import { toast, toastError } from '@/lib/toast'

type Member = { profile_id: string; full_name: string; role: string; is_muted: boolean }

export function Thread({ convId, title, readOnly, onBack }: { convId: string; title: string; readOnly?: boolean; onBack?: () => void }) {
  const { me, school } = useMe()
  const sb = supabaseBrowser()
  const [msgs, setMsgs] = useState<any[]>([])
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [people, setPeople] = useState(false)
  const { busy, run } = useAction()
  const box = useRef<HTMLDivElement>(null)
  const members = useAsync<Member[]>(() => q(sb.rpc('conversation_members_info', { p_conversation_id: convId })), [convId])
  const byId = useMemo(() => Object.fromEntries((members.data || []).map((m) => [m.profile_id, m])), [members.data])
  const maxMb = Number(setting(school, 'max_upload_mb', 10))

  const load = useCallback(async () => {
    try {
      const data = await q(
        sb.from('messages')
          .select('id,sender_id,body,sent_at,deleted_at,message_files(id,storage_path,file_name,size_bytes)')
          .eq('conversation_id', convId).order('sent_at', { ascending: true }).limit(300)
      )
      setMsgs(data)
      if (!readOnly) {
        await sb.rpc('mark_conversation_read', { p_conversation_id: convId })
        window.dispatchEvent(new Event('edunest:refresh-counts'))
      }
    } catch (e) { toastError(e) }
  }, [convId, readOnly, sb])

  useEffect(() => {
    setMsgs([])
    load()
    const ch = sb
      .channel('conv-' + convId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, load)
      .subscribe()
    const t = setInterval(load, 30000)
    return () => { sb.removeChannel(ch); clearInterval(t) }
  }, [convId, load, sb])

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }) }, [msgs.length])

  const send = () =>
    run(async () => {
      const body = text.trim()
      if (!body && files.length === 0) return
      const tooBig = files.find((f) => f.size > maxMb * 1024 * 1024)
      if (tooBig) throw new Error(`${tooBig.name} is larger than ${maxMb} MB`)
      const up = []
      for (const f of files) up.push(await uploadFile('chat', me.school_id, convId, f))
      await q(sb.rpc('send_message', { p_conversation_id: convId, p_body: body, p_files: up }))
      setText(''); setFiles([])
      await load()
    })

  const del = (id: string) => window.confirm('Remove this message?') && run(async () => { await q(sb.rpc('delete_message', { p_id: id })); await load() })
  const report = (id: string) => {
    const reason = window.prompt('Why are you reporting this message? (the class teacher and school office will see it)')
    if (reason === null) return
    run(async () => { await q(sb.rpc('report_message', { p_id: id, p_reason: reason })) }, 'Reported. The school will look at it.')
  }
  const mute = (profile: string, muted: boolean) =>
    run(async () => { await q(sb.rpc('set_member_mute', { p_conversation_id: convId, p_profile: profile, p_muted: muted })); members.reload() }, muted ? 'Muted' : 'Unmuted')

  const isStaff = me.role !== 'student'
  return (
    <div className="pane">
      <div className="pane-head">
        <div className="row">
          {onBack && <button className="btn ghost small back" onClick={onBack}>← Back</button>}
          <b>{title}</b>
          {readOnly && <Badge kind="warn">Review mode</Badge>}
        </div>
        <Button small onClick={() => setPeople(true)}>People</Button>
      </div>
      <div className="msgs" ref={box}>
        {msgs.length === 0 && <Empty>No messages yet. Say hello 👋</Empty>}
        {msgs.map((m) => {
          const mine = m.sender_id === me.id
          const who = byId[m.sender_id]
          if (m.deleted_at) return <div key={m.id} className={cx('msg', 'gone', mine && 'me')}>Message removed</div>
          return (
            <div key={m.id} className={cx('msg', mine && 'me')}>
              {!mine && <div className="who">{who?.full_name || 'Someone'}{who?.role === 'teacher' && ' · Teacher'}{who?.role === 'admin' && ' · School office'}</div>}
              {m.body && <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}
              {(m.message_files || []).map((f: any) => (
                <div key={f.id}>
                  <button className="btn small" style={{ marginTop: 6 }} onClick={() => openFile('chat', f.storage_path).catch(toastError)}>
                    📎 {f.file_name} <span className="muted">{fmtSize(f.size_bytes)}</span>
                  </button>
                </div>
              ))}
              <div className="when">
                <span>{fmtDateTime(m.sent_at, school.timezone)}</span>
                {(mine || me.role === 'admin') && <button onClick={() => del(m.id)}>Remove</button>}
                {!mine && !readOnly && <button onClick={() => report(m.id)}>Report</button>}
                {isStaff && !readOnly && !mine && who?.role === 'student' && (
                  <button onClick={() => mute(m.sender_id, !who.is_muted)}>{who.is_muted ? 'Unmute' : 'Mute'}</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {!readOnly && (
        <div>
          {files.length > 0 && (
            <div className="row" style={{ padding: '6px 10px 0' }}>
              {files.map((f, i) => <Badge key={i} kind="accent">{f.name} <a onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ cursor: 'pointer' }}>✕</a></Badge>)}
            </div>
          )}
          <div className="composer">
            <label className="btn" title={`Attach a file (up to ${maxMb} MB)`} style={{ cursor: 'pointer' }}>
              📎
              <input type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])]); e.currentTarget.value = '' }} />
            </label>
            <textarea
              className="input" rows={1} placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            />
            <Button variant="primary" loading={busy} onClick={send}>Send</Button>
          </div>
        </div>
      )}
      {people && (
        <Modal title="People in this chat" onClose={() => setPeople(false)}>
          <table className="table"><tbody>
            {(members.data || []).map((m) => (
              <tr key={m.profile_id}>
                <td>{m.full_name} <span className="muted small">{m.role === 'student' ? 'Student' : m.role === 'teacher' ? 'Teacher' : 'School office'}</span></td>
                <td className="num">
                  {m.is_muted && <Badge kind="bad">Muted</Badge>}{' '}
                  {isStaff && m.role === 'student' && <Button small onClick={() => mute(m.profile_id, !m.is_muted)}>{m.is_muted ? 'Unmute' : 'Mute'}</Button>}
                </td>
              </tr>
            ))}
          </tbody></table>
        </Modal>
      )}
    </div>
  )
}

function NewChat({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const [search, setSearch] = useState('')
  const term = useDebounced(search, 250)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')
  const [classId, setClassId] = useState('')
  const { busy, run } = useAction()
  const contacts = useAsync<any[]>(() => q(sb.rpc('chat_contacts', { p_query: term || null })), [term])
  const classes = useAsync<any[]>(async () => {
    if (me.role === 'student') return []
    const year = await q(sb.from('academic_years').select('id').eq('is_current', true).maybeSingle())
    if (!year) return []
    const all = await q(sb.from('classes').select('id,section,class_teacher_id,grade:grade_levels(name)').eq('academic_year_id', year.id))
    if (me.role === 'admin') return all
    const ta = await q(sb.from('teaching_assignments').select('class_id').eq('teacher_id', me.id))
    const mine = new Set(ta.map((x: any) => x.class_id))
    return all.filter((c: any) => mine.has(c.id) || c.class_teacher_id === me.id)
  }, [])

  const ids = Object.keys(picked)
  const start = () =>
    run(async () => {
      const id = await q(sb.rpc('start_conversation', classId ? { p_member_ids: [], p_class_id: classId } : { p_member_ids: ids, p_title: title || null }))
      onCreated(id)
    })

  return (
    <Modal title="New chat" onClose={onClose} footer={
      <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!classId && ids.length === 0} onClick={start}>Start</Button></>
    }>
      {me.role !== 'student' && (classes.data || []).length > 0 && (
        <Field label="Or message a whole class" hint="Every student of the class joins the group">
          <select className="input" value={classId} onChange={(e) => { setClassId(e.target.value); setPicked({}) }}>
            <option value="">— pick people below instead —</option>
            {(classes.data || []).map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}
          </select>
        </Field>
      )}
      {!classId && (
        <>
          <Field label="Find people"><input className="input" placeholder="Type a name" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <div style={{ maxHeight: 280, overflowY: 'auto', margin: '10px 0' }}>
            {contacts.loading && !contacts.data && <div className="center"><Spinner /></div>}
            {contacts.data?.length === 0 && <Empty>No one to show{term ? ' for that search' : ''}.</Empty>}
            {(contacts.data || []).map((c) => (
              <label key={c.id} className="check" style={{ padding: '7px 4px', borderBottom: '1px solid var(--line)' }}>
                <input type="checkbox" checked={!!picked[c.id]} onChange={(e) => {
                  const n = { ...picked }
                  if (e.target.checked) n[c.id] = c.full_name; else delete n[c.id]
                  setPicked(n)
                }} />
                <span className="avatar" style={{ width: 28, height: 28, fontSize: '.7rem' }}>{initials(c.full_name)}</span>
                <span>{c.full_name}<br /><span className="small muted">{c.role === 'teacher' ? 'Teacher' : c.role === 'admin' ? 'School office' : 'Student'}{c.subtitle ? ` · ${c.subtitle}` : ''}</span></span>
              </label>
            ))}
          </div>
          {ids.length > 1 && <Field label="Group name (optional)"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>}
        </>
      )}
    </Modal>
  )
}

export default function Chat() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const [sel, setSel] = useState<string | null>(null)
  const [neu, setNeu] = useState(false)
  const list = useAsync<any[]>(() => q(sb.rpc('my_conversations')), [])

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('c')
    if (c) setSel(c)
    const ch = sb.channel('convlist-' + me.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => list.reload())
      .subscribe()
    return () => { sb.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cur = (list.data || []).find((c) => c.id === sel)
  return (
    <>
      {me.role === 'student' && (
        <Alert>Be kind and keep chats about school. Teachers and the school office can read conversations, and you can report any message.</Alert>
      )}
      <div className={cx('chat', sel && 'thread-open')}>
        <div className="list">
          <div className="row between" style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
            <b>Chats</b>
            <Button small variant="primary" onClick={() => setNeu(true)}>+ New</Button>
          </div>
          {list.loading && !list.data && <div className="center"><Spinner /></div>}
          {list.data?.length === 0 && <Empty>No chats yet.<br />Tap “New” to start one.</Empty>}
          {(list.data || []).map((c) => (
            <div key={c.id} className={cx('conv', sel === c.id && 'on')} onClick={() => { setSel(c.id); list.reload() }}>
              <span className="avatar">{c.is_group ? '👥' : initials(c.title)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="t">{c.title}</div>
                <div className="s">{c.last_body || 'No messages yet'}</div>
              </div>
              {Number(c.unread) > 0 && <span className="dot">{c.unread}</span>}
            </div>
          ))}
        </div>
        {sel && cur ? (
          <Thread key={sel} convId={sel} title={cur.title} onBack={() => { setSel(null); list.reload() }} />
        ) : (
          <div className="pane"><div className="center muted" style={{ flex: 1 }}>Choose a chat or start a new one.</div></div>
        )}
      </div>
      {neu && <NewChat onClose={() => setNeu(false)} onCreated={(id) => { setNeu(false); list.reload(); setSel(id) }} />}
    </>
  )
}
