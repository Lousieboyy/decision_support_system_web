"""
migrate_sqlite_to_postgres.py
Migrates all data from the SQLite reports.db to PostgreSQL smart_city_db.
Safe to run multiple times — skips rows that already exist.
"""

import sqlite3
import sys
import os

# ── Config ────────────────────────────────────────────────────────────────────
SQLITE_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "smart_city_citizen_reporting_app",
    "ai_backend",
    "reports.db"
)

PG_HOST     = "localhost"
PG_DB       = "smart_city_db"
PG_USER     = "postgres"
PG_PASSWORD = "abc123"
# ─────────────────────────────────────────────────────────────────────────────

try:
    import psycopg2
except ImportError:
    import subprocess
    print("Installing psycopg2-binary...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
    import psycopg2

# ── Connect to SQLite ─────────────────────────────────────────────────────────
if not os.path.exists(SQLITE_PATH):
    print(f"ERROR: SQLite DB not found at:\n  {SQLITE_PATH}")
    sys.exit(1)

print(f"Reading SQLite DB: {SQLITE_PATH}")
sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_conn.row_factory = sqlite3.Row
sqlite_cur = sqlite_conn.cursor()

# ── Connect to PostgreSQL ─────────────────────────────────────────────────────
print(f"Connecting to PostgreSQL: {PG_DB}@{PG_HOST}...")
pg_conn = psycopg2.connect(
    host=PG_HOST,
    database=PG_DB,
    user=PG_USER,
    password=PG_PASSWORD
)
pg_cur = pg_conn.cursor()

# ─────────────────────────────────────────────────────────────────────────────
#  MIGRATE USERS
# ─────────────────────────────────────────────────────────────────────────────
print("\n-- Migrating users --------------------------------------------------")
sqlite_cur.execute("SELECT * FROM users")
users = sqlite_cur.fetchall()
print(f"  Found {len(users)} user(s) in SQLite.")

users_inserted = 0
users_skipped  = 0
for u in users:
    u = dict(u)
    # Use ON CONFLICT to safely skip both id and username duplicates
    pg_cur.execute("""
        INSERT INTO users (id, username, password_hash, role)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT DO NOTHING
    """, (
        u["id"],
        u["username"],
        u["password_hash"],
        u.get("role", "citizen"),
    ))
    if pg_cur.rowcount == 0:
        print(f"  SKIP  user id={u['id']} username='{u['username']}' (already exists)")
        users_skipped += 1
    else:
        print(f"  OK    user id={u['id']} username='{u['username']}' role='{u.get('role','citizen')}'")
        users_inserted += 1

# Sync the PostgreSQL sequence so future INSERTs don't conflict
pg_cur.execute("SELECT MAX(id) FROM users")
max_id = pg_cur.fetchone()[0] or 0
pg_cur.execute(f"SELECT setval('users_id_seq', {max(max_id, 1)}, true)")
pg_conn.commit()
print(f"  >> Inserted: {users_inserted}  Skipped: {users_skipped}")

# -----------------------------------------------------------------------------
#  MIGRATE REPORTS
# -----------------------------------------------------------------------------
print("\n-- Migrating reports ------------------------------------------------")

# Get columns available in SQLite
sqlite_cur.execute("PRAGMA table_info(reports)")
sqlite_cols = {row[1] for row in sqlite_cur.fetchall()}
print(f"  SQLite columns: {sorted(sqlite_cols)}")

sqlite_cur.execute("SELECT * FROM reports")
reports = sqlite_cur.fetchall()
print(f"  Found {len(reports)} report(s) in SQLite.")

reports_inserted = 0
reports_skipped  = 0

for r in reports:
    r = dict(r)
    # Handle timestamp: SQLite may store as string
    timestamp = r.get("timestamp")

    pg_cur.execute("""
        INSERT INTO reports (
            id, user_id, description, location, address,
            latitude, longitude, categories, ai_prediction, confidence,
            image_path, status, timestamp,
            assigned_department, authority_notes, forwarded_at, reviewed_at,
            assigned_worker, in_process_at, in_maintenance_at,
            completion_image_path, completion_notes, completion_submitted_at,
            worker_completed,
            completion_ai_prediction, completion_confidence,
            resolved_at
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s,
            %s, %s,
            %s
        )
        ON CONFLICT DO NOTHING
    """, (
        r["id"],
        r.get("user_id"),
        r.get("description"),
        r.get("location"),
        r.get("address"),
        r.get("latitude"),
        r.get("longitude"),
        r.get("categories"),
        r.get("ai_prediction"),
        r.get("confidence"),
        r.get("image_path"),
        r.get("status", "Pending"),
        timestamp,
        r.get("assigned_department"),
        r.get("authority_notes"),
        r.get("forwarded_at"),
        r.get("reviewed_at"),
        r.get("assigned_worker"),
        r.get("in_process_at"),
        r.get("in_maintenance_at"),
        r.get("completion_image_path"),
        r.get("completion_notes"),
        r.get("completion_submitted_at"),
        int(r.get("worker_completed", 0)),
        r.get("completion_ai_prediction") if "completion_ai_prediction" in sqlite_cols else None,
        r.get("completion_confidence")    if "completion_confidence"    in sqlite_cols else None,
        r.get("resolved_at"),
    ))
    if pg_cur.rowcount == 0:
        print(f"  SKIP  report id={r['id']} (already exists)")
        reports_skipped += 1
    else:
        print(f"  OK    report id={r['id']} status='{r.get('status','Pending')}'")
        reports_inserted += 1

# Sync the reports sequence
pg_cur.execute("SELECT MAX(id) FROM reports")
max_id = pg_cur.fetchone()[0] or 0
pg_cur.execute(f"SELECT setval('reports_id_seq', {max(max_id, 1)}, true)")
pg_conn.commit()
print(f"  >> Inserted: {reports_inserted}  Skipped: {reports_skipped}")

# -- Final verification --------------------------------------------------------
print("\n-- Verification -----------------------------------------------------")
pg_cur.execute("SELECT COUNT(*) FROM users")
print(f"  PostgreSQL users  count : {pg_cur.fetchone()[0]}")
pg_cur.execute("SELECT COUNT(*) FROM reports")
print(f"  PostgreSQL reports count: {pg_cur.fetchone()[0]}")

pg_cur.close()
pg_conn.close()
sqlite_conn.close()
print("\n[DONE] Migration complete!\n")
