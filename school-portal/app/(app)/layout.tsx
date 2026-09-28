import { redirect } from 'next/navigation'
import Shell from '@/components/Shell'
import { ProfileProvider } from '@/lib/profile'
import { supabaseServer } from '@/lib/supabase-server'
import { ALLOWED_ROLES, APP_NAME, NAV, TAGLINE } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id,full_name,role,login_id,school_id,is_active,disabled_from,must_change_password,school:schools(id,name,code,timezone,settings)')
    .eq('id', user.id)
    .maybeSingle()

  const today = new Date().toISOString().slice(0, 10)
  const ok = profile && profile.is_active && (!profile.disabled_from || profile.disabled_from > today) && ALLOWED_ROLES.includes(profile.role) && profile.school
  if (!ok) redirect('/api/logout?e=access')
  if (profile.must_change_password) redirect('/change-password')

  const me = { id: profile.id, full_name: profile.full_name, role: profile.role, login_id: profile.login_id, school_id: profile.school_id }
  return (
    <ProfileProvider me={me} school={profile.school as any}>
      <Shell nav={NAV} appName={APP_NAME} tagline={TAGLINE}>{children}</Shell>
    </ProfileProvider>
  )
}
