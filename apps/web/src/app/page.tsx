'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RootPage() {
  const router = useRouter()
  useEffect(() => {
    const token = localStorage.getItem('wave_token')
    if (token) router.replace('/panel')
    else router.replace('/login')
  }, [router])
  return null
}
