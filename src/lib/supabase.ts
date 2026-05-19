import { createClient } from '@supabase/supabase-js'

const SB_URL = 'https://gohluceldchoitihrimw.supabase.co'
const SB_KEY = 'sb_publishable_Su-BxUMybE1ysGiLxqNilg_YhYgItOJ'

export const supabase = createClient(SB_URL, SB_KEY)
