'use client'

import { usePathname, useRouter } from 'next/navigation'

interface Props {
  serverList: Array<{ id: string; name: string; status: string }>
  userEmail: string
}

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-emerald-500',
  stopped: 'bg-slate-500',
  installing: 'bg-amber-500',
  error: 'bg-rose-500'
}

export function NavSidebar({ serverList, userEmail }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  function logout() {
    localStorage.removeItem('wave_token')
    router.push('/login')
  }

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-slate-800 bg-slate-950">
      <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-800">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-indigo-600 font-bold text-white text-sm">W</div>
        <span className="text-sm font-semibold text-slate-100">Wave Panel</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Overview</p>
        <NavItem label="Dashboard" href="/panel" active={pathname === '/panel'} onClick={() => router.push('/panel')} />

        {serverList.length > 0 && (
          <>
            <p className="px-3 py-2 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Servers</p>
            {serverList.map(server => (
              <button
                key={server.id}
                onClick={() => router.push(`/panel/servers/${server.id}`)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  pathname.startsWith(`/panel/servers/${server.id}`)
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[server.status] ?? 'bg-slate-500'}`} />
                <span className="truncate">{server.name}</span>
              </button>
            ))}
          </>
        )}

        <p className="px-3 py-2 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Admin</p>
        <NavItem label="Settings" href="/panel/settings" active={pathname.startsWith('/panel/settings')} onClick={() => router.push('/panel/settings')} />
      </nav>

      <div className="border-t border-slate-800 px-4 py-3">
        <p className="text-xs text-slate-400 truncate">{userEmail}</p>
        <button onClick={logout} className="mt-1 text-xs text-rose-400 hover:text-rose-300">Sign out</button>
      </div>
    </aside>
  )
}

function NavItem({ label, active, onClick }: { label: string; href: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors ${
        active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
      }`}
    >
      {label}
    </button>
  )
}
