'use client'
import { supabaseBrowser } from './supabase-browser'
import { safeName, uuid } from './util'

export async function uploadFile(bucket: 'notes' | 'chat', schoolId: string, folder: string, file: File) {
  const path = `${schoolId}/${folder}/${uuid()}-${safeName(file.name)}`
  const { error } = await supabaseBrowser().storage.from(bucket).upload(path, file, { contentType: file.type || undefined })
  if (error) throw error
  return { path, name: file.name, size: file.size }
}

export async function openFile(bucket: 'notes' | 'chat', path: string) {
  const { data, error } = await supabaseBrowser().storage.from(bucket).createSignedUrl(path, 300)
  if (error) throw error
  window.open(data.signedUrl, '_blank', 'noopener')
}
