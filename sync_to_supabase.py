#!/usr/bin/env python3
"""
GeoWake — Sync Local SQLite (geowake.db) to Supabase Cloud PostgreSQL
Run this script to upload all existing local users and trips to your Supabase project.
"""

import os
import sys
import json
import sqlite3
import urllib.request

# Ensure UTF-8 output on Windows terminals
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def load_env():
    env_file = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.isfile(env_file):
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    k = k.strip()
                    v = v.strip().strip('\'"')
                    if k and k not in os.environ:
                        os.environ[k] = v

load_env()

raw_url = os.environ.get('SUPABASE_URL', '').strip().rstrip('/')
if raw_url.endswith('/rest/v1'):
    raw_url = raw_url[:-8].rstrip('/')
SUPABASE_URL = raw_url
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', '').strip()
DB_FILE = os.path.join(os.path.dirname(__file__), 'geowake.db')

def main():
    print("=" * 60)
    print(" GeoWake -> Supabase Cloud Migration Tool")
    print("=" * 60)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[ERROR] SUPABASE_URL or SUPABASE_KEY is missing in .env")
        return

    print(f"[CONNECT] Target Supabase URL: {SUPABASE_URL}")
    if not os.path.isfile(DB_FILE):
        print(f"[INFO] Local database {DB_FILE} does not exist yet.")
        return

    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # 1. Read Users
    c.execute('SELECT id, username, email, name, password_hash, password_salt, role, created_at, last_login FROM users')
    raw_users = [dict(r) for r in c.fetchall()]
    users = []
    seen_usernames = set()
    for u in raw_users:
        uname = u.get('username')
        if not uname:
            if u.get('email'):
                uname = u['email'].split('@')[0]
                u['username'] = uname
            else:
                continue
        if uname.lower() not in seen_usernames:
            seen_usernames.add(uname.lower())
            users.append(u)

    print(f"[INFO] Found {len(users)} valid user accounts in SQLite.")

    # 2. Read Trips
    c.execute('SELECT * FROM trips')
    trips = [dict(r) for r in c.fetchall()]
    print(f"[INFO] Found {len(trips)} local trips in SQLite.")
    conn.close()

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
    }

    # Upload Users
    if users:
        print("[SYNC] Uploading users to Supabase 'users' table...")
        try:
            req = urllib.request.Request(
                f"{SUPABASE_URL}/rest/v1/users",
                data=json.dumps(users).encode('utf-8'),
                headers=headers,
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                print(f"[OK] Successfully uploaded {len(users)} users (Status: {resp.status})")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='ignore')
            print(f"[WARNING] Users upload error (HTTP {e.code}): {err_body}")
        except Exception as e:
            print(f"[ERROR] Users upload failed: {e}")

    # Upload Trips
    if trips:
        print("[SYNC] Uploading trips to Supabase 'trips' table...")
        try:
            req = urllib.request.Request(
                f"{SUPABASE_URL}/rest/v1/trips",
                data=json.dumps(trips).encode('utf-8'),
                headers=headers,
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                print(f"[OK] Successfully uploaded {len(trips)} trips (Status: {resp.status})")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='ignore')
            print(f"[WARNING] Trips upload error (HTTP {e.code}): {err_body}")
        except Exception as e:
            print(f"[ERROR] Trips upload failed: {e}")

    print("\n[COMPLETE] Migration process finished.")

if __name__ == '__main__':
    main()
