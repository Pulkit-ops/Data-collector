import importlib
import os, json, uuid, csv, io, zipfile, shutil
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, redirect, url_for, send_file, Response
# Use flask_socketio if available, otherwise provide a lightweight fallback so the app can run
try:
    if importlib.util.find_spec('flask_socketio') is not None:
        flask_socketio = importlib.import_module('flask_socketio')
        SocketIO = flask_socketio.SocketIO
        emit = flask_socketio.emit
    else:
        raise ImportError
except Exception:
    # minimal no-op emit and SocketIO shim for environments without flask_socketio installed
    def emit(event, *args, **kwargs):
        return None

    class SocketIO:
        def __init__(self, app=None, **kwargs):
            self._handlers = {}
            self.app = app

        def emit(self, event, data=None, **kwargs):
            return None

        def on(self, event):
            def decorator(f):
                self._handlers[event] = f
                return f
            return decorator

        def run(self, app, debug=False, host='127.0.0.1', port=5000):
            # fallback to Flask's built-in server
            app.run(debug=debug, host=host, port=port)

# ── App setup ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR  = os.path.join(BASE_DIR, 'data')
DB_FILE   = os.path.join(DATA_DIR, 'datatrack.json')
BCK_DIR   = os.path.join(DATA_DIR, 'backups')
os.makedirs(BCK_DIR, exist_ok=True)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'datatrack-secret-key-2025'
socketio = SocketIO(app, cors_allowed_origins='*')

# ── Persistent JSON "database" ─────────────────────────────────────────────────
def load_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'r') as f:
            return json.load(f)
    return {
        'records':   [],
        'audit_log': [],
        'users': [
            {'id': 'u1', 'name': 'Admin User',  'role': 'Administrator', 'email': 'admin@company.com',  'created_at': now_iso(), 'active': True},
            {'id': 'u2', 'name': 'Jane Smith',   'role': 'Manager',       'email': 'jane@company.com',   'created_at': now_iso(), 'active': True},
            {'id': 'u3', 'name': 'Bob Chen',     'role': 'Analyst',       'email': 'bob@company.com',    'created_at': now_iso(), 'active': True},
        ],
        'settings': {'username': 'Admin User', 'role': 'Administrator', 'backup_freq': 'Daily', 'default_status': 'pending'},
        'backups':  [],
    }

def save_db(db):
    with open(DB_FILE, 'w') as f:
        json.dump(db, f, indent=2, default=str)

def now_iso():
    return datetime.utcnow().isoformat() + 'Z'

def gen_id(prefix='R'):
    return prefix + uuid.uuid4().hex[:8].upper()

# ── Audit helper ───────────────────────────────────────────────────────────────
def add_audit(db, action, record_id, record_title, note, by):
    entry = {
        'id': gen_id('A'), 'action': action,
        'record_id': record_id, 'record_title': record_title,
        'note': note, 'by': by, 'at': now_iso()
    }
    db['audit_log'].insert(0, entry)
    db['audit_log'] = db['audit_log'][:500]

# ── Date helpers ───────────────────────────────────────────────────────────────
def parse_iso(s):
    if not s: return None
    try:
        return datetime.fromisoformat(s.replace('Z',''))
    except Exception:
        return None

def is_today(s):
    d = parse_iso(s)
    if not d: return False
    t = datetime.utcnow()
    return d.date() == t.date()

def is_yesterday(s):
    d = parse_iso(s)
    if not d: return False
    return d.date() == (datetime.utcnow() - timedelta(days=1)).date()

def is_this_week(s):
    d = parse_iso(s)
    if not d: return False
    start = datetime.utcnow() - timedelta(days=datetime.utcnow().weekday())
    return d.date() >= start.date()

def is_this_month(s):
    d = parse_iso(s)
    if not d: return False
    n = datetime.utcnow()
    return d.year == n.year and d.month == n.month

# ── ROUTES — Pages ─────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

# ── ROUTES — Records ───────────────────────────────────────────────────────────
@app.route('/api/records', methods=['GET'])
def get_records():
    db = load_db()
    recs = db['records']
    status   = request.args.get('status', '')
    priority = request.args.get('priority', '')
    q        = request.args.get('q', '').lower()
    if status:
        recs = [r for r in recs if r.get('status') == status]
    if priority:
        recs = [r for r in recs if r.get('priority') == priority]
    if q:
        recs = [r for r in recs if q in r.get('title','').lower()
                or q in r.get('department','').lower()
                or q in r.get('created_by','').lower()
                or q in r.get('description','').lower()]
    return jsonify({'records': recs, 'total': len(db['records'])})

@app.route('/api/records', methods=['POST'])
def create_record():
    db   = load_db()
    data = request.get_json()
    if not data.get('title','').strip():
        return jsonify({'error': 'Title is required'}), 400
    rec = {
        'id':           gen_id('R'),
        'title':        data.get('title','').strip(),
        'department':   data.get('department', 'Engineering'),
        'priority':     data.get('priority', 'medium'),
        'status':       data.get('status', 'pending'),
        'assigned_to':  data.get('assigned_to', ''),
        'description':  data.get('description', ''),
        'due_date':     data.get('due_date', ''),
        'tags':         data.get('tags', []),
        'created_at':   now_iso(),
        'created_by':   data.get('created_by', db['settings']['username']),
        'updated_at':   now_iso(),
        'updated_by':   data.get('created_by', db['settings']['username']),
    }
    db['records'].insert(0, rec)
    add_audit(db, 'create', rec['id'], rec['title'], 'Record created', rec['created_by'])
    save_db(db)
    socketio.emit('record_update', {'action': 'create', 'record': rec})
    return jsonify({'record': rec}), 201

@app.route('/api/records/<record_id>', methods=['GET'])
def get_record(record_id):
    db = load_db()
    rec = next((r for r in db['records'] if r['id'] == record_id), None)
    if not rec:
        return jsonify({'error': 'Not found'}), 404
    history = [a for a in db['audit_log'] if a.get('record_id') == record_id]
    return jsonify({'record': rec, 'history': history})

@app.route('/api/records/<record_id>', methods=['PUT'])
def update_record(record_id):
    db   = load_db()
    data = request.get_json()
    idx  = next((i for i, r in enumerate(db['records']) if r['id'] == record_id), None)
    if idx is None:
        return jsonify({'error': 'Not found'}), 404
    rec = db['records'][idx]
    rec.update({
        'title':       data.get('title', rec['title']),
        'department':  data.get('department', rec['department']),
        'priority':    data.get('priority', rec['priority']),
        'status':      data.get('status', rec['status']),
        'assigned_to': data.get('assigned_to', rec.get('assigned_to','')),
        'description': data.get('description', rec.get('description','')),
        'due_date':    data.get('due_date', rec.get('due_date','')),
        'tags':        data.get('tags', rec.get('tags',[])),
        'updated_at':  now_iso(),
        'updated_by':  data.get('updated_by', db['settings']['username']),
    })
    db['records'][idx] = rec
    add_audit(db, 'update', record_id, rec['title'], 'Record updated', rec['updated_by'])
    save_db(db)
    socketio.emit('record_update', {'action': 'update', 'record': rec})
    return jsonify({'record': rec})

@app.route('/api/records/<record_id>', methods=['DELETE'])
def delete_record(record_id):
    db  = load_db()
    rec = next((r for r in db['records'] if r['id'] == record_id), None)
    if not rec:
        return jsonify({'error': 'Not found'}), 404
    db['records'] = [r for r in db['records'] if r['id'] != record_id]
    add_audit(db, 'delete', record_id, rec.get('title',''), 'Record deleted', db['settings']['username'])
    save_db(db)
    socketio.emit('record_update', {'action': 'delete', 'record_id': record_id})
    return jsonify({'success': True})

# ── ROUTES — Dashboard ─────────────────────────────────────────────────────────
@app.route('/api/dashboard')
def dashboard():
    db   = load_db()
    recs = db['records']
    total      = len(recs)
    completed  = sum(1 for r in recs if r.get('status') == 'completed')
    pending    = sum(1 for r in recs if r.get('status') == 'pending')
    today_added   = sum(1 for r in recs if is_today(r.get('created_at','')))
    today_updated = sum(1 for r in recs if is_today(r.get('updated_at','')) and not is_today(r.get('created_at','')))
    in_progress= sum(1 for r in recs if r.get('status') == 'in-progress')
    cancelled  = sum(1 for r in recs if r.get('status') == 'cancelled')

    # 7-day activity
    activity = []
    for i in range(6, -1, -1):
        d = (datetime.utcnow() - timedelta(days=i)).date()
        label = d.strftime('%a %d')
        added   = sum(1 for r in recs if parse_iso(r.get('created_at','')) and parse_iso(r.get('created_at','')).date() == d)
        updated = sum(1 for r in recs if parse_iso(r.get('updated_at','')) and parse_iso(r.get('updated_at','')).date() == d and parse_iso(r.get('created_at','')) and parse_iso(r.get('created_at','')).date() != d)
        activity.append({'label': label, 'added': added, 'updated': updated})

    # User counts
    user_counts = {}
    for r in recs:
        u = r.get('created_by','Unknown')
        user_counts[u] = user_counts.get(u, 0) + 1
    user_activity = sorted(user_counts.items(), key=lambda x: -x[1])

    # Monthly trend (last 6 months)
    trend = []
    for i in range(5, -1, -1):
        d = datetime.utcnow().replace(day=1) - timedelta(days=i*28)
        count = sum(1 for r in recs if parse_iso(r.get('created_at','')) and
                    parse_iso(r.get('created_at','')).year == d.year and
                    parse_iso(r.get('created_at','')).month == d.month)
        trend.append({'label': d.strftime('%b'), 'count': count})

    return jsonify({
        'total': total, 'completed': completed, 'pending': pending,
        'in_progress': in_progress, 'cancelled': cancelled,
        'today_added': today_added, 'today_updated': today_updated,
        'activity': activity, 'user_activity': user_activity,
        'recent': recs[:5], 'trend': trend
    })

# ── ROUTES — Daily ─────────────────────────────────────────────────────────────
@app.route('/api/daily')
def daily():
    db   = load_db()
    recs = db['records']
    tab  = request.args.get('tab', 'today')
    fn_map = {'today': is_today, 'yesterday': is_yesterday, 'week': is_this_week, 'month': is_this_month}
    fn = fn_map.get(tab, is_today)
    filtered = [r for r in recs if fn(r.get('created_at',''))]
    return jsonify({
        'records':   filtered,
        'total':     len(filtered),
        'completed': sum(1 for r in filtered if r.get('status') == 'completed'),
        'pending':   sum(1 for r in filtered if r.get('status') == 'pending'),
    })

# ── ROUTES — Reports ───────────────────────────────────────────────────────────
@app.route('/api/reports')
def reports():
    db   = load_db()
    recs = db['records']
    today_added   = [r for r in recs if is_today(r.get('created_at',''))]
    today_updated = [r for r in recs if is_today(r.get('updated_at','')) and not is_today(r.get('created_at',''))]

    # Dept breakdown
    dept_counts = {}
    for r in recs:
        d = r.get('department','Other')
        dept_counts[d] = dept_counts.get(d, 0) + 1

    # User performance (total)
    user_perf = {}
    for r in recs:
        u = r.get('created_by','Unknown')
        user_perf[u] = user_perf.get(u, 0) + 1
    user_perf = sorted(user_perf.items(), key=lambda x: -x[1])

    # Monthly trend
    trend = []
    for i in range(5, -1, -1):
        d = datetime.utcnow().replace(day=1) - timedelta(days=i*28)
        count = sum(1 for r in recs if parse_iso(r.get('created_at','')) and
                    parse_iso(r.get('created_at','')).year == d.year and
                    parse_iso(r.get('created_at','')).month == d.month)
        trend.append({'label': d.strftime('%b'), 'count': count})

    return jsonify({
        'today_added':   len(today_added),
        'today_updated': len(today_updated),
        'total_pending':   sum(1 for r in recs if r.get('status') == 'pending'),
        'total_completed': sum(1 for r in recs if r.get('status') == 'completed'),
        'dept_counts': dept_counts,
        'user_perf':   user_perf,
        'trend':       trend,
        'date_label':  datetime.utcnow().strftime('%A, %d %B %Y'),
    })

# ── ROUTES — Audit ─────────────────────────────────────────────────────────────
@app.route('/api/audit')
def audit():
    db = load_db()
    return jsonify({'log': db['audit_log'][:100]})

@app.route('/api/audit/export')
def export_audit():
    db = load_db()
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(['ID', 'Action', 'Record ID', 'Record Title', 'Note', 'By', 'Timestamp'])
    for a in db['audit_log']:
        w.writerow([a.get('id'), a.get('action'), a.get('record_id'), a.get('record_title'), a.get('note'), a.get('by'), a.get('at')])
    output.seek(0)
    return Response(output.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': f'attachment; filename=audit_log_{datetime.utcnow().strftime("%Y%m%d")}.csv'})

# ── ROUTES — Backup ────────────────────────────────────────────────────────────
@app.route('/api/backups', methods=['GET'])
def get_backups():
    db = load_db()
    return jsonify({'backups': db.get('backups', [])})

@app.route('/api/backups', methods=['POST'])
def create_backup():
    db = load_db()
    backup_id   = gen_id('B')
    backup_file = os.path.join(BCK_DIR, f'{backup_id}.json')
    with open(backup_file, 'w') as f:
        json.dump({'records': db['records'], 'audit_log': db['audit_log']}, f, indent=2)
    size = os.path.getsize(backup_file)
    entry = {
        'id':           backup_id,
        'created_at':   now_iso(),
        'by':           db['settings']['username'],
        'size':         size,
        'size_kb':      round(size / 1024, 1),
        'record_count': len(db['records']),
        'file':         backup_file,
    }
    db.setdefault('backups', []).insert(0, entry)
    db['backups'] = db['backups'][:10]
    save_db(db)
    return jsonify({'backup': entry}), 201

@app.route('/api/backups/<backup_id>/restore', methods=['POST'])
def restore_backup(backup_id):
    db = load_db()
    backup = next((b for b in db.get('backups',[]) if b['id'] == backup_id), None)
    if not backup or not os.path.exists(backup['file']):
        return jsonify({'error': 'Backup not found'}), 404
    with open(backup['file']) as f:
        snap = json.load(f)
    db['records']   = snap.get('records', [])
    db['audit_log'] = snap.get('audit_log', [])
    add_audit(db, 'restore', backup_id, f'Backup {backup_id}', 'Data restored from backup', db['settings']['username'])
    save_db(db)
    socketio.emit('record_update', {'action': 'restore'})
    return jsonify({'success': True, 'record_count': len(db['records'])})

# ── ROUTES — Users ─────────────────────────────────────────────────────────────
@app.route('/api/users', methods=['GET'])
def get_users():
    db = load_db()
    users = db.get('users', [])
    recs  = db['records']
    for u in users:
        u['record_count'] = sum(1 for r in recs if r.get('created_by') == u['name'])
        last = max((r.get('created_at','') for r in recs if r.get('created_by') == u['name']), default=None)
        u['last_active'] = last
    return jsonify({'users': users})

@app.route('/api/users', methods=['POST'])
def add_user():
    db   = load_db()
    data = request.get_json()
    if not data.get('name','').strip():
        return jsonify({'error': 'Name is required'}), 400
    user = {'id': gen_id('U'), 'name': data['name'].strip(), 'role': data.get('role','Analyst'),
            'email': data.get('email',''), 'created_at': now_iso(), 'active': True}
    db.setdefault('users', []).append(user)
    save_db(db)
    return jsonify({'user': user}), 201

# ── ROUTES — Settings ──────────────────────────────────────────────────────────
@app.route('/api/settings', methods=['GET'])
def get_settings():
    db = load_db()
    return jsonify(db.get('settings', {}))

@app.route('/api/settings', methods=['PUT'])
def update_settings():
    db   = load_db()
    data = request.get_json()
    db['settings'].update(data)
    save_db(db)
    return jsonify(db['settings'])

# ── ROUTES — Export ────────────────────────────────────────────────────────────
@app.route('/api/export/csv')
def export_csv():
    db = load_db()
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(['ID','Title','Department','Priority','Status','Assigned To','Created By','Created At','Updated By','Updated At','Tags','Description'])
    for r in db['records']:
        w.writerow([r.get('id'), r.get('title'), r.get('department'), r.get('priority'),
                    r.get('status'), r.get('assigned_to'), r.get('created_by'), r.get('created_at'),
                    r.get('updated_by'), r.get('updated_at'), ';'.join(r.get('tags',[])), r.get('description','')])
    output.seek(0)
    return Response(output.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': f'attachment; filename=records_{datetime.utcnow().strftime("%Y%m%d")}.csv'})

# ── ROUTES — Seed & Clear ──────────────────────────────────────────────────────
@app.route('/api/seed', methods=['POST'])
def seed():
    db = load_db()
    import random
    titles = ['Q3 Performance Review','Client Onboarding — TechCorp','Marketing Campaign Launch',
              'Infrastructure Upgrade','Budget Reconciliation Q4','Product Roadmap Update',
              'Security Audit','Team Restructuring','Vendor Contract Renewal','Annual Compliance Review']
    depts    = ['Engineering','Marketing','Sales','HR','Finance','Operations','Product','Design']
    statuses = ['pending','in-progress','completed','cancelled']
    priorities= ['high','medium','low']
    names    = ['Admin User','Jane Smith','Bob Chen','Sarah Lee','Mike Patel']
    for title in titles:
        offset = timedelta(days=random.randint(0,30))
        created= (datetime.utcnow() - offset).isoformat() + 'Z'
        rec = {
            'id': gen_id('R'), 'title': title,
            'department': random.choice(depts),
            'priority':   random.choice(priorities),
            'status':     random.choice(statuses),
            'assigned_to':random.choice(names),
            'description':f'Sample description for {title}.',
            'due_date':   (datetime.utcnow() + timedelta(days=random.randint(5,60))).strftime('%Y-%m-%d'),
            'tags':       ['sample','demo'],
            'created_at': created, 'created_by': random.choice(names),
            'updated_at': created, 'updated_by': random.choice(names),
        }
        db['records'].insert(0, rec)
        add_audit(db, 'create', rec['id'], rec['title'], 'Seeded', rec['created_by'])
    save_db(db)
    socketio.emit('record_update', {'action': 'seed'})
    return jsonify({'success': True, 'added': len(titles)})

@app.route('/api/clear', methods=['POST'])
def clear_all():
    db = load_db()
    db['records']   = []
    db['audit_log'] = []
    save_db(db)
    socketio.emit('record_update', {'action': 'clear'})
    return jsonify({'success': True})

# ── SocketIO events ────────────────────────────────────────────────────────────
@socketio.on('connect')
def on_connect():
    emit('connected', {'msg': 'Real-time sync active'})

# ── Run ────────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 55)
    print("  DataTrack Pro — Python Edition")
    print("  http://localhost:5000")
    print("=" * 55)
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)