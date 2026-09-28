'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errMsg } from './util'
import { toast, toastError } from './toast'

/** Load data on mount / when deps change. `reload()` refetches. */
export function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: undefined }))
    fnRef.current()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => alive && setState((s) => ({ ...s, loading: false, error: errMsg(e) })))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/** Wraps an action: tracks "busy" and shows errors as toasts. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    setBusy(true)
    try {
      const r = await fn()
      if (okMsg) toast(okMsg, 'good')
      return r
    } catch (e) {
      toastError(e)
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, run }
}
