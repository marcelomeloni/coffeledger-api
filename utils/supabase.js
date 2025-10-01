// utils/supabase.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('As credenciais do Supabase (URL e Anon Key) são necessárias no .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);