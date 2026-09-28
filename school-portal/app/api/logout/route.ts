import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

async function out(req: NextRequest) {
  await supabaseServer().auth.signOut()
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = req.nextUrl.searchParams.get('e') ? `?e=${encodeURIComponent(req.nextUrl.searchParams.get('e') as string)}` : ''
  return NextResponse.redirect(url, { status: 303 })
}
export const POST = out
export const GET = out
