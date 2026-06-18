'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getCurrentUserAsync, canAccess, firstAllowedRoute } from '@/lib/auth'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router    = useRouter()
  const pathname  = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    setReady(false)

    if (pathname === '/login') {
      setReady(true)
      return () => { alive = false }
    }

    async function checkAccess() {
      const user = await getCurrentUserAsync()
      if (!alive) return

      if (!user) {
        router.replace('/login')
        return
      }

      if (!canAccess(user, pathname)) {
        router.replace(firstAllowedRoute(user))
        return
      }

      setReady(true)
    }

    checkAccess()
    return () => { alive = false }
  }, [pathname, router])

  if (!ready) return null

  return <>{children}</>
}
