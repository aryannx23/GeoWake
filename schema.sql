-- =========================================================================
-- GeoWake — Supabase Cloud Database Schema
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run
-- =========================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    name TEXT,
    email TEXT,
    password_hash TEXT,
    password_salt TEXT,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TRIPS TABLE
CREATE TABLE IF NOT EXISTS public.trips (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    destination_name TEXT NOT NULL,
    destination_full_name TEXT,
    dest_lat DOUBLE PRECISION,
    dest_lon DOUBLE PRECISION,
    origin_name TEXT,
    origin_lat DOUBLE PRECISION,
    origin_lon DOUBLE PRECISION,
    alert_radius DOUBLE PRECISION DEFAULT 500,
    alarm_sound TEXT DEFAULT 'loud',
    route_distance DOUBLE PRECISION DEFAULT 0,
    travel_duration TEXT,
    status TEXT DEFAULT 'Completed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- 4. CREATE POLICIES FOR PUBLIC / ANON ACCESS
-- Users Table Access Policies
DROP POLICY IF EXISTS "Allow anon read users" ON public.users;
CREATE POLICY "Allow anon read users" ON public.users 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow anon insert users" ON public.users;
CREATE POLICY "Allow anon insert users" ON public.users 
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update users" ON public.users;
CREATE POLICY "Allow anon update users" ON public.users 
    FOR UPDATE USING (true);

-- Trips Table Access Policies
DROP POLICY IF EXISTS "Allow anon read trips" ON public.trips;
CREATE POLICY "Allow anon read trips" ON public.trips 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow anon insert trips" ON public.trips;
CREATE POLICY "Allow anon insert trips" ON public.trips 
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update trips" ON public.trips;
CREATE POLICY "Allow anon update trips" ON public.trips 
    FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow anon delete trips" ON public.trips;
CREATE POLICY "Allow anon delete trips" ON public.trips 
    FOR DELETE USING (true);

-- 5. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_trips_user ON public.trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_created ON public.trips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(LOWER(username));
