'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ServerRecord } from '@/lib/api'
import { NavSidebar } from '@/components/nav-sidebar'

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [serverList, setServerList] = useState<Pick<ServerRecord, 'id' | 'name' | 'status'>[]>([])

  useEffect(() => {
    const token = localStorage.getItem('wave_token')
    if (!token) { router.replace('/login'); return }
    const cached = localStorage.getItem('wave_user')
    if (cached) {
      try { setUserEmail(JSON.parse(cached).email) } catch {}
    }
    setReady(true)
    api.servers.list().then(servers => setServerList(servers.map(s => ({ id: s.id, name: s.name, status: s.status }))))
  }, [router])

  if (!ready) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <p className="text-slate-400 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-slate-950">
      <NavSidebar serverList={serverList} userEmail={userEmail} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
