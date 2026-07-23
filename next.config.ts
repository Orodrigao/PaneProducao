import type { NextConfig } from 'next'
import {
  assertSafeSupabaseEnvironment,
  assertValidSupabasePublicKey,
} from './src/lib/environmentSafety'

const nextConfig: NextConfig = {
  output: 'export',
}

export default async function configureNext(): Promise<NextConfig> {
  assertSafeSupabaseEnvironment({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    vercelEnvironment: process.env.VERCEL_ENV,
  })
  await assertValidSupabasePublicKey({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })

  return nextConfig
}
