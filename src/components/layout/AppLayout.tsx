import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopHeader from './TopHeader'

function getInitialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem('dafra-sidebar-collapsed')
    if (saved !== null) return saved === 'true'
  } catch {}
  return window.matchMedia('(max-width: 767px)').matches
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed)

  function toggle() {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('dafra-sidebar-collapsed', String(next)) } catch {}
      return next
    })
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopHeader />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
