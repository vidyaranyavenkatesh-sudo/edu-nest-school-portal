'use client'
import { createContext, useContext } from 'react'

export type Me = { id: string; full_name: string; role: 'admin' | 'teacher' | 'student'; login_id: string; school_id: string }
export type SchoolInfo = { id: string; name: string; timezone: string; settings: any; code?: string }
const Ctx = createContext<{ me: Me; school: SchoolInfo } | null>(null)

export function ProfileProvider({ me, school, children }: { me: Me; school: SchoolInfo; children: React.ReactNode }) {
  return <Ctx.Provider value={{ me, school }}>{children}</Ctx.Provider>
}
export function useMe() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMe outside ProfileProvider')
  return v
}
/** A school setting with the built-in default. */
export function setting(school: SchoolInfo, key: string, fallback: any): any {
  const v = school?.settings?.[key]
  return v === undefined || v === null ? fallback : v
}
