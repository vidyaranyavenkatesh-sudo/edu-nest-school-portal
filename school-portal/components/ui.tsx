'use client'
import React, { useEffect } from 'react'
import { cx } from '@/lib/util'
import { useToasts } from '@/lib/toast'

export function Button({ variant, small, loading, className, children, ...rest }: any) {
  return (
    <button className={cx('btn', variant, small && 'small', className)} disabled={loading || rest.disabled} {...rest}>
      {loading && <span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} />}
      {children}
    </button>
  )
}

export function Card({ title, actions, children, flush, className }: any) {
  return (
    <div className={cx('card', flush && 'flush', className)}>
      {(title || actions) && (
        <div className="row between" style={{ marginBottom: 12, padding: flush ? '16px 18px 0' : 0 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export function PageHead({ title, sub, children }: any) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  )
}

export function Field({ label, hint, children, className }: any) {
  return (
    <label className={cx('field', className)}>
      {label}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function Badge({ kind, children }: any) {
  return <span className={cx('badge', kind)}>{children}</span>
}

const STATUS: Record<string, [string, string]> = {
  present: ['good', 'Present'], absent: ['bad', 'Absent'], late: ['warn', 'Late'], leave: ['accent', 'On leave'],
  pending: ['warn', 'Pending'], approved: ['good', 'Approved'], rejected: ['bad', 'Not approved'],
  suggested: ['warn', 'Suggested'], accepted: ['good', 'Accepted'], declined: ['bad', 'Declined'],
  unassigned: ['bad', 'Needs a teacher'], self_study: ['accent', 'Self study'],
  draft: ['', 'Draft'], submitted: ['accent', 'Submitted'], locked: ['warn', 'Locked'], published: ['good', 'Published'],
  proposed: ['warn', 'Proposed'], applied: ['good', 'Applied'], reversed: ['', 'Reversed'],
  open: ['warn', 'Open'], reviewed: ['good', 'Reviewed'], dismissed: ['', 'Dismissed'],
}
export function StatusBadge({ status }: { status: string }) {
  const [k, label] = STATUS[status] || ['', status]
  return <Badge kind={k}>{label}</Badge>
}

export function Alert({ kind, children }: any) {
  return <div className={cx('alert', kind)}>{children}</div>
}
export const Empty = ({ children }: any) => <div className="empty">{children}</div>
export const Spinner = () => <span className="spin" />

/** Shows a spinner while loading and an error box if loading failed. */
export function Loading({ loading, error, children, hasData = true }: any) {
  if (error) return <Alert kind="bad">{error}</Alert>
  if (loading && !hasData) return <div className="center"><Spinner /></div>
  return <>{children}</>
}

export function Modal({ title, onClose, wide, children, footer }: any) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
        {footer && <div className="row end" style={{ marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  )
}

export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="tabs">
      {tabs.map(([k, label]) => (
        <button key={k} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

export function Stat({ n, l, sub }: any) {
  return (
    <div className="card stat">
      <div className="n">{n ?? '–'}</div>
      <div className="l">{l}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  )
}

export function Confirm({ message, onConfirm, children, ...rest }: any) {
  return (
    <Button
      {...rest}
      onClick={() => {
        if (window.confirm(message || 'Are you sure?')) onConfirm()
      }}
    >
      {children}
    </Button>
  )
}

export function Bar({ value, low = 75 }: { value: number | null; low?: number }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, Number(value)))
  return <div className={cx('bar', value != null && Number(value) < low && 'low')}><i style={{ width: `${v}%` }} /></div>
}

export function Toaster() {
  const list = useToasts()
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => <div key={t.id} className={cx('toast', t.kind)}>{t.msg}</div>)}
    </div>
  )
}

export function Segmented({ value, onChange, disabled }: { value?: string; onChange: (v: string) => void; disabled?: boolean }) {
  const opts: [string, string, string][] = [['present', 'P', 'p'], ['absent', 'A', 'a'], ['late', 'L', 'l'], ['leave', 'Leave', 'v']]
  return (
    <div className="seg" role="group">
      {opts.map(([k, label, c]) => (
        <button key={k} type="button" disabled={disabled} className={cx(c, value === k && 'on')} onClick={() => onChange(k)} title={STATUS[k][1]}>{label}</button>
      ))}
    </div>
  )
}
