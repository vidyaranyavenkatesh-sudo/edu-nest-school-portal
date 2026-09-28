import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env'

/** A Supabase client that acts as the signed-in user (cookies), for server components and route handlers. */
export function supabaseServer() {
  const store = cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch {
          /* called from a server component: the middleware refreshes cookies instead */
        }
      },
    },
  })
}
