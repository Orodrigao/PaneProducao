'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getCurrentUser, canAccess, firstAllowedRoute } from '@/lib/auth'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router    = useRouter()
  const pathname  = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (pathname === '/login') {
      setReady(true)
      return
    }

    const user = getCurrentUser()

    if (!user) {
      router.replace('/login')
      return
    }

    if (!canAccess(user, pathname)) {
      router.replace(firstAllowedRoute(user))
      return
    }

    setReady(true)
  }, [pathname, router])

  if (!ready) return null

  return <>{children}</>
}
