import os
import json
import sqlite3
import time
import hashlib
import hmac
import re
import secrets
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Load environment variables from .env if present
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
PORT = int(os.environ.get('PORT', 8000))
DB_FILE = os.path.join(os.path.dirname(__file__), 'geowake.db')

def hash_password(password, salt=None):
    """Secure password hashing using standard PBKDF2-HMAC-SHA256 (100,000 iterations)."""
    if not salt:
        salt = os.urandom(16).hex()
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
    return pwd_hash, salt

def verify_password(password, salt, stored_hash):
    """Constant-time verification of password against stored PBKDF2 hash."""
    if not password or not salt or not stored_hash:
        return False
    calc_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
    return hmac.compare_digest(calc_hash, stored_hash)

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            google_id TEXT UNIQUE,
            email TEXT UNIQUE,
            name TEXT NOT NULL,
            picture TEXT,
            password_hash TEXT,
            password_salt TEXT,
            username TEXT UNIQUE,
            role TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            remember_me INTEGER DEFAULT 0,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS login_history (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            remember_me INTEGER DEFAULT 0,
            ip_address TEXT,
            user_agent TEXT,
            login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'SUCCESS',
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id)')

    c.execute('''
        CREATE TABLE IF NOT EXISTS trips (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            destination_name TEXT NOT NULL,
            destination_full_name TEXT,
            dest_lat REAL,
            dest_lon REAL,
            origin_name TEXT,
            origin_lat REAL,
            origin_lon REAL,
            alert_radius REAL,
            alarm_sound TEXT,
            route_distance REAL,
            travel_duration TEXT,
            status TEXT DEFAULT 'Completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

class GeoWakeRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow cross-origin if accessed via local network IP or mobile
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        # Cache control for development
        if self.path.endswith('.js') or self.path.endswith('.css') or self.path.endswith('.html'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        # Auth Configuration Endpoint
        if parsed.path == '/api/config/auth':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'authType': 'username_password',
                'googleOAuth': False,
                'status': 'open_access'
            }).encode('utf-8'))
            return

        elif parsed.path == '/api/stats':
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('SELECT COUNT(*) FROM users')
            user_count = c.fetchone()[0]
            c.execute('SELECT COUNT(*) FROM trips')
            trip_count = c.fetchone()[0]
            conn.close()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'online',
                'database': 'sqlite3',
                'users': user_count,
                'trips': trip_count
            }).encode('utf-8'))
            return

        elif parsed.path == '/api/user/trips':
            user_id = params.get('userId', [None])[0]
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            if user_id:
                c.execute('SELECT * FROM trips WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', (user_id,))
            else:
                c.execute('SELECT * FROM trips ORDER BY created_at DESC LIMIT 20')
            rows = [dict(row) for row in c.fetchall()]
            conn.close()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'trips': rows}).encode('utf-8'))
            return

        elif parsed.path == '/api/user/login-history':
            user_id = params.get('userId', [None])[0]
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            if user_id:
                c.execute('SELECT * FROM login_history WHERE user_id = ? ORDER BY login_time DESC LIMIT 20', (user_id,))
            else:
                c.execute('SELECT * FROM login_history ORDER BY login_time DESC LIMIT 20')
            rows = [dict(row) for row in c.fetchall()]
            conn.close()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'logins': rows}).encode('utf-8'))
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8')
        data = json.loads(post_data) if post_data else {}

        # ── 1. USER REGISTRATION (USERNAME & PASSWORD) ──
        if parsed.path == '/api/auth/register':
            username = data.get('username', '').strip()
            password = data.get('password', '')
            name = data.get('name', '').strip()
            remember_me = 1 if data.get('rememberMe', True) else 0

            if not username or len(username) < 3:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Username must be at least 3 characters long.'}).encode('utf-8'))
                return

            if not re.match(r'^[a-zA-Z0-9_-]+$', username):
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Username can only contain letters, numbers, hyphens, and underscores.'}).encode('utf-8'))
                return

            if not password or len(password) < 4:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Password must be at least 4 characters long.'}).encode('utf-8'))
                return

            if not re.search(r'[A-Z]', password):
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Password must contain at least one uppercase letter (A-Z).'}).encode('utf-8'))
                return

            if not re.search(r'[0-9]', password):
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Password must contain at least one number (0-9).'}).encode('utf-8'))
                return

            if not re.search(r'[^a-zA-Z0-9]', password):
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Password must contain at least one special character (e.g. !@#$%^&*).'}).encode('utf-8'))
                return

            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            # Check if username already exists
            c.execute('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', (username,))
            if c.fetchone():
                conn.close()
                self.send_response(409)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Username is already taken. Please choose another.'}).encode('utf-8'))
                return

            user_id = 'usr-' + str(abs(hash(str(time.time()) + username)))
            display_name = name if name else username
            email = f"{username.lower()}@geowake.local"
            pwd_hash, salt = hash_password(password)

            c.execute('''
                INSERT INTO users (id, username, email, name, password_hash, password_salt, role)
                VALUES (?, ?, ?, ?, ?, ?, 'user')
            ''', (user_id, username, email, display_name, pwd_hash, salt))

            # Generate Session and Record Login in Database
            session_token = secrets.token_hex(32)
            duration_seconds = 30 * 86400 if remember_me else 86400
            expires_at = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(time.time() + duration_seconds))
            ip_address = self.client_address[0] if self.client_address else '127.0.0.1'
            user_agent = self.headers.get('User-Agent', '')

            c.execute('''
                INSERT INTO sessions (token, user_id, remember_me, ip_address, user_agent, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (session_token, user_id, remember_me, ip_address, user_agent, expires_at))

            hist_id = 'log-' + secrets.token_hex(12)
            c.execute('''
                INSERT INTO login_history (id, user_id, username, remember_me, ip_address, user_agent, status)
                VALUES (?, ?, ?, ?, ?, ?, 'REGISTER_LOGIN')
            ''', (hist_id, user_id, username, remember_me, ip_address, user_agent))

            conn.commit()
            conn.close()

            print(f"[AUTH] Registered new user: {username} ({user_id}) - Session created (remember={remember_me})")

            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'message': 'Account successfully created!',
                'user': {
                    'id': user_id,
                    'username': username,
                    'name': display_name
                },
                'sessionToken': session_token,
                'rememberMe': bool(remember_me)
            }).encode('utf-8'))
            return

        # ── 2. USER LOGIN (USERNAME & PASSWORD) WITH REMEMBER ME ──
        elif parsed.path == '/api/auth/login':
            username = data.get('username', '').strip()
            password = data.get('password', '')
            remember_me = 1 if data.get('rememberMe') else 0

            if not username or not password:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Please enter both username and password.'}).encode('utf-8'))
                return

            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            c.execute('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', (username, username))
            user_row = c.fetchone()

            ip_address = self.client_address[0] if self.client_address else '127.0.0.1'
            user_agent = self.headers.get('User-Agent', '')

            if not user_row or not user_row['password_hash']:
                conn.close()
                self.send_response(401)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Invalid username or password.'}).encode('utf-8'))
                return

            if not verify_password(password, user_row['password_salt'], user_row['password_hash']):
                # Record failed login attempt in login_history
                try:
                    c.execute('''
                        INSERT INTO login_history (id, user_id, username, remember_me, ip_address, user_agent, status)
                        VALUES (?, ?, ?, ?, ?, ?, 'FAILED_PASSWORD')
                    ''', ('log-' + secrets.token_hex(12), user_row['id'], user_row['username'] or username, remember_me, ip_address, user_agent))
                    conn.commit()
                except Exception:
                    pass
                conn.close()
                self.send_response(401)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Invalid username or password.'}).encode('utf-8'))
                return

            # Successful login: generate session token & persist in database
            user_id = user_row['id']
            session_token = secrets.token_hex(32)
            duration_seconds = 30 * 86400 if remember_me else 86400
            expires_at = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(time.time() + duration_seconds))

            # Store active session
            c.execute('''
                INSERT INTO sessions (token, user_id, remember_me, ip_address, user_agent, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (session_token, user_id, remember_me, ip_address, user_agent, expires_at))

            # Record login event in login_history table
            hist_id = 'log-' + secrets.token_hex(12)
            c.execute('''
                INSERT INTO login_history (id, user_id, username, remember_me, ip_address, user_agent, status)
                VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS')
            ''', (hist_id, user_id, user_row['username'] or username, remember_me, ip_address, user_agent))

            # Update last_login in users table
            c.execute('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', (user_id,))
            conn.commit()
            conn.close()

            print(f"[AUTH] User logged in: {user_row['username'] or username} ({user_id}) - Remember Me: {bool(remember_me)}")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'message': 'Login successful!',
                'user': {
                    'id': user_id,
                    'username': user_row['username'] or username,
                    'name': user_row['name']
                },
                'sessionToken': session_token,
                'rememberMe': bool(remember_me)
            }).encode('utf-8'))
            return

        # ── 3. VERIFY ACTIVE SESSION TOKEN ──
        elif parsed.path == '/api/auth/verify-session':
            session_token = data.get('sessionToken', '').strip()
            if not session_token:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'valid': False, 'error': 'Missing session token.'}).encode('utf-8'))
                return

            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute('''
                SELECT s.token, s.user_id, s.remember_me, s.expires_at,
                       u.username, u.name, u.email, u.role
                FROM sessions s
                JOIN users u ON s.user_id = u.id
                WHERE s.token = ?
            ''', (session_token,))
            row = c.fetchone()

            if not row:
                conn.close()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'valid': False, 'error': 'Session not found or expired.'}).encode('utf-8'))
                return

            # Check expiration
            expires_at = row['expires_at']
            current_time = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())
            if expires_at and expires_at < current_time:
                c.execute('DELETE FROM sessions WHERE token = ?', (session_token,))
                conn.commit()
                conn.close()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'valid': False, 'error': 'Session expired.'}).encode('utf-8'))
                return

            conn.close()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'valid': True,
                'user': {
                    'id': row['user_id'],
                    'username': row['username'],
                    'name': row['name'],
                    'email': row['email'],
                    'role': row['role']
                },
                'rememberMe': bool(row['remember_me'])
            }).encode('utf-8'))
            return

        # ── 4. LOGOUT (REVOKE SESSION TOKEN) ──
        elif parsed.path == '/api/auth/logout':
            session_token = data.get('sessionToken', '').strip()
            user_id = data.get('userId', '').strip()
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            if session_token:
                c.execute('DELETE FROM sessions WHERE token = ?', (session_token,))
            elif user_id:
                c.execute('DELETE FROM sessions WHERE user_id = ?', (user_id,))
            conn.commit()
            conn.close()

            print(f"[AUTH] Session revoked for token: {session_token[:8]}..." if session_token else "[AUTH] Session logged out")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'message': 'Logged out successfully.'}).encode('utf-8'))
            return

        # ── 5. SAVE TRIP RECORD ──
        elif parsed.path == '/api/user/trips':
            trip_id = data.get('id') or ('trip-' + str(abs(hash(str(os.urandom(8))))))
            user_id = data.get('userId') or 'local-user'
            dest_name = data.get('destinationName', 'Destination')
            dest_full = data.get('destinationFullName', '')
            dest_lat = data.get('destLat')
            dest_lon = data.get('destLon')
            origin_name = data.get('originName', '')
            origin_lat = data.get('originLat')
            origin_lon = data.get('originLon')
            alert_radius = data.get('alertRadius', 500)
            alarm_sound = data.get('alarmSound', 'loud')
            route_dist = data.get('routeDistance', 0)
            duration = data.get('travelDuration', '')
            status = data.get('status', 'Completed')

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('''
                INSERT OR REPLACE INTO trips (
                    id, user_id, destination_name, destination_full_name,
                    dest_lat, dest_lon, origin_name, origin_lat, origin_lon,
                    alert_radius, alarm_sound, route_distance, travel_duration, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                trip_id, user_id, dest_name, dest_full,
                dest_lat, dest_lon, origin_name, origin_lat, origin_lon,
                alert_radius, alarm_sound, route_dist, duration, status
            ))
            conn.commit()
            conn.close()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'tripId': trip_id}).encode('utf-8'))
            return

        self.send_response(404)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'error': 'Endpoint not found'}).encode('utf-8'))

if __name__ == '__main__':
    init_db()
    server = HTTPServer(('0.0.0.0', PORT), GeoWakeRequestHandler)
    print(f"GeoWake Server with SQLite Database running at http://localhost:{PORT}")
    print("Authentication: Simple Username & Password Active")
    server.serve_forever()
