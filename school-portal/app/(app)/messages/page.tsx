'use client'
import Chat from '@/components/Chat'
import { PageHead } from '@/components/ui'

export default function Messages() {
  return (
    <>
      <PageHead title="Messages" sub="Chat with your students and colleagues" />
      <Chat />
    </>
  )
}
