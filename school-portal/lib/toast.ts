'use client'
import { useEffect, useState } from 'react'
import { errMsg } from './util'

export type ToastItem = { id: number; msg: string; kind: '' | 'good' | 'bad' }
let items: ToastItem[] = []
let n = 0
const listeners = new Set<(t: ToastItem[]) => void>()
const emit = () => listeners.forEach((l) => l(items))

export function toast(msg: string, kind: '' | 'good' | 'bad' = '') {
  const t = { id: ++n, msg, kind }
  items = [...items, t]
  emit()
  setTimeout(() => { items = items.filter((x) => x.id !== t.id); emit() }, kind === 'bad' ? 7000 : 4000)
}
export const toastError = (e: any, fallback?: string) => {
  toast(fallback ? `${fallback}: ${errMsg(e)}` : errMsg(e), 'bad')
}
export function useToasts() {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => { listeners.add(setList); return () => { listeners.delete(setList) } }, [])
  return list
}
