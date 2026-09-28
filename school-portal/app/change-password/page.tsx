import { redirect } from 'next/navigation'
import ChangePasswordForm from '@/components/ChangePasswordForm'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function ChangePasswordPage() {
  const supabase = supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('login_id,must_change_password').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/api/logout?e=access')
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">E</div>
        <h1>Choose a new password</h1>
        <ChangePasswordForm forced loginId={profile.login_id} />
      </div>
    </div>
  )
}
