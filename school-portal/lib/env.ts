// Public settings (safe to expose in the browser).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
/** Login IDs are turned into hidden e-mail addresses on this domain. It never receives mail. */
export const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || 'login.invalid'

export const normalizeLoginId = (s: string) => String(s || '').trim().toUpperCase()
export const loginIdToEmail = (s: string) => `${normalizeLoginId(s).toLowerCase()}@${LOGIN_DOMAIN}`
export const validLoginId = (s: string) => /^[A-Z0-9._-]{3,40}$/.test(normalizeLoginId(s))
