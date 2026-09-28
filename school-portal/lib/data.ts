'use client'
import { useAsync } from './hooks'
import { supabaseBrowser } from './supabase-browser'
import { q } from './util'
import { useMe } from './profile'

export const sortClasses = (list: any[]) =>
  [...list].sort((a, b) => (a.grade?.order_no ?? 0) - (b.grade?.order_no ?? 0) || String(a.section).localeCompare(String(b.section)))

const CLASS_COLS = 'id,section,grade_level_id,class_teacher_id,chat_enabled,academic_year_id,grade:grade_levels(name,order_no)'

export async function fetchClasses(yearId: string) {
  const sb = supabaseBrowser()
  return sortClasses(await q<any[]>(sb.from('classes').select(CLASS_COLS).eq('academic_year_id', yearId)))
}

export function useCurrentYear() {
  const sb = supabaseBrowser()
  return useAsync<any>(() => q(sb.from('academic_years').select('id,name,start_date,end_date,is_current').eq('is_current', true).maybeSingle()), [])
}
export function useYears() {
  const sb = supabaseBrowser()
  return useAsync<any[]>(() => q(sb.from('academic_years').select('id,name,start_date,end_date,is_current').order('start_date', { ascending: false })), [])
}
export function useTeachers() {
  const sb = supabaseBrowser()
  return useAsync<any[]>(() => q(sb.from('profiles').select('id,full_name,login_id').eq('role', 'teacher').eq('is_active', true).order('full_name')), [])
}
export function useSubjects() {
  const sb = supabaseBrowser()
  return useAsync<any[]>(() => q(sb.from('subjects').select('id,name,code').order('name')), [])
}
export function usePeriods() {
  const sb = supabaseBrowser()
  return useAsync<any[]>(() => q(sb.from('periods').select('id,number,label,start_time,end_time').order('number')), [])
}
export function useGrades() {
  const sb = supabaseBrowser()
  return useAsync<any[]>(() => q(sb.from('grade_levels').select('id,name,order_no').order('order_no')), [])
}

/** Classes of the current year that the signed-in person teaches (admins: all). */
export function useMyClasses() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  return useAsync<{ year: any; classes: any[]; ownClassIds: string[]; assignments: any[] }>(async () => {
    const year = await q<any>(sb.from('academic_years').select('id,name,start_date,end_date').eq('is_current', true).maybeSingle())
    if (!year) return { year: null, classes: [], ownClassIds: [], assignments: [] }
    const all = await fetchClasses(year.id)
    const ids = all.map((c) => c.id)
    const assignments = await q<any[]>(
      me.role === 'admin'
        ? sb.from('teaching_assignments').select('class_id,subject_id,teacher_id').in('class_id', ids)
        : sb.from('teaching_assignments').select('class_id,subject_id,teacher_id').eq('teacher_id', me.id).in('class_id', ids)
    )
    const ownClassIds = all.filter((c) => c.class_teacher_id === me.id).map((c) => c.id)
    if (me.role === 'admin') return { year, classes: all, ownClassIds, assignments }
    const mine = new Set([...assignments.map((a) => a.class_id), ...ownClassIds])
    return { year, classes: all.filter((c) => mine.has(c.id)), ownClassIds, assignments }
  }, [])
}
