'use client'
import { Alert, PageHead } from '@/components/ui'
import { useMe } from '@/lib/profile'

// Every page under /admin/* is for the school office only. Nav already hides these
// links from teachers, but this catches anyone who opens the address directly --
// the database would refuse any real change anyway, but there is no reason to show
// the form itself to someone who cannot use it.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { me } = useMe()
  if (me.role !== 'admin') {
    return (
      <>
        <PageHead title="School office" />
        <Alert kind="warn">Only the school office can see this page.</Alert>
      </>
    )
  }
  return <>{children}</>
}
