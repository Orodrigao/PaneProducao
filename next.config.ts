import type { NextConfig } from 'next'
import { assertSafeSupabaseEnvironment } from './src/lib/environmentSafety'

assertSafeSupabaseEnvironment({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  vercelEnvironment: process.env.VERCEL_ENV,
})

const nextConfig: NextConfig = {
  output: 'export',
}
export default nextConfig
