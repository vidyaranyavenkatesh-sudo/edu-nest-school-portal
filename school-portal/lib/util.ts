export const cx = (...a: any[]) => a.filter(Boolean).join(' ')

export const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Today's date (YYYY-MM-DD) in the school's time zone. */
export function todayISO(tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
export function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** 1 = Monday ... 7 = Sunday */
export function isoWeekday(iso: string) {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay()
  return d === 0 ? 7 : d
}
export const startOfWeek = (iso: string) => addDays(iso, 1 - isoWeekday(iso))
export const monthStart = (iso: string) => iso.slice(0, 7) + '-01'
export function monthEnd(iso: string) {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
export function addMonths(iso: string, n: number) {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10)
}
export function fmtDate(iso: string) {
  if (!iso) return ''
  return new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
export function fmtMonth(iso: string) {
  return new Date(iso.slice(0, 7) + '-01T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' })
}
export function fmtDateTime(ts: string, tz = 'Asia/Kolkata') {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-IN', { timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
export function fmtTime(t: string) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
export const classLabel = (c: any) => (c ? `${c.grade?.name ?? ''} ${c.section ?? ''}`.trim() : '')
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
export const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').slice(-80)
export const fmtSize = (b?: number) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

/** Unwrap a Supabase response: return data or throw the error. */
export async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data
}

/** Turn database/network errors into a sentence a teacher or student can act on. */
export function errMsg(e: any): string {
  const m: string = (e && (e.message || e.error_description || e.details)) || String(e || 'Something went wrong')
  if (/substitutions_no_double_booking/.test(m)) return 'That teacher is already booked for another class in this period.'
  if (/timetable_entries_class_id_weekday_period_id_key/.test(m)) return 'This class already has a lesson in that period.'
  if (/timetable_entries_academic_year_id_teacher_id_weekday_period_id_key/.test(m)) return 'That teacher already has a class in that period.'
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that."
  if (/duplicate key|already exists/i.test(m)) return 'That already exists.'
  if (/violates foreign key/i.test(m)) return 'This is still being used somewhere, so it cannot be removed.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Network problem. Check your connection and try again.'
  if (/JWT expired|not authenticated/i.test(m)) return 'Your session has ended. Please log in again.'
  return m
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** Very small CSV reader (handles quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') inQ = false
      else cell += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

export const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
export const uuid = () => (typeof crypto !== 'undefined' && (crypto as any).randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16) }))
