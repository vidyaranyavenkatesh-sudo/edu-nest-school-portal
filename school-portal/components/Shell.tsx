'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { cx, initials } from '@/lib/util'

export type NavItem = { href: string; label: string; roles?: string[]; group?: string; badge?: 'messages' | 'notices' | 'notifications' }

function useCounts(profileId: string) {
  const [c, setC] = useState({ messages: 0, notices: 0, notifications: 0 })
  const load = useCallback(async () => {
    const sb = supabaseBrowser()
    try {
      const [m, n1, n2] = await Promise.all([
        sb.rpc('my_conversations'),
        sb.from('notice_reads').select('notice_id', { count: 'exact', head: true }).eq('profile_id', profileId).is('read_at', null),
        sb.from('notifications').select('id', { count: 'exact', head: true }).eq('profile_id', profileId).is('read_at', null),
      ])
      setC({
        messages: ((m.data as any[]) || []).reduce((s, x) => s + Number(x.unread || 0), 0),
        notices: n1.count || 0,
        notifications: n2.count || 0,
      })
    } catch { /* ignore */ }
  }, [profileId])
  useEffect(() => {
    const sb = supabaseBrowser()
    load()
    const t = setInterval(load, 60000)
    window.addEventListener('edunest:refresh-counts', load)
    const ch = sb
      .channel('counts-' + profileId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notice_reads', filter: `profile_id=eq.${profileId}` }, load)
      .subscribe()
    return () => { clearInterval(t); window.removeEventListener('edunest:refresh-counts', load); sb.removeChannel(ch) }
  }, [load, profileId])
  return c
}

export default function Shell({ nav, appName, tagline, children }: { nav: NavItem[]; appName: string; tagline: string; children: React.ReactNode }) {
  const { me, school } = useMe()
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const counts = useCounts(me.id)
  useEffect(() => setOpen(false), [path])

  const items = nav.filter((n) => !n.roles || n.roles.includes(me.role))
  let lastGroup = ''
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'))

  return (
    <div className="shell">
      <div className={cx('scrim', open && 'open')} onClick={() => setOpen(false)} />
      <aside className={cx('sidebar', open && 'open')}>
        <div className="brand">
          <span className="logo">E</span>
          <span>{appName}<small className="muted">{school.name}</small></span>
        </div>
        <nav className="nav">
          {items.map((n) => {
            const head = n.group && n.group !== lastGroup ? <div key={'g' + n.group} className="nav-group">{n.group}</div> : null
            if (n.group) lastGroup = n.group
            const badge = n.badge ? counts[n.badge] : 0
            return (
              <Fragment key={n.href}>
                {head}
                <Link href={n.href} className={cx(active(n.href) && 'active')}>
                  <span>{n.label}</span>
                  {badge > 0 && <span className="dot">{badge > 99 ? '99+' : badge}</span>}
                </Link>
              </Fragment>
            )
          })}
        </nav>
        <div style={{ flex: 1 }} />
        <div className="small muted" style={{ padding: 16 }}>{tagline}</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost burger" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <span className="hide-sm muted small">{school.name}</span>
          <div className="who">
            <Link href="/notifications" className="btn ghost small" aria-label="Alerts" title="Alerts">
              🔔{counts.notifications > 0 && <span className="dot">{counts.notifications}</span>}
            </Link>
            <span className="avatar">{initials(me.full_name)}</span>
            <span className="hide-sm">
              <b>{me.full_name}</b>
              <br />
              <span className="small muted">{me.login_id}</span>
            </span>
            <form action="/api/logout" method="post"><button className="btn small" type="submit">Log out</button></form>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
