"""
reset_reports_to_pending.py
Resets ALL reports in reports.db back to "Pending" status,
clearing all workflow stage fields so the 5-stage lifecycle
can be re-run from scratch.
"""

import sqlite3
import os

DB_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "smart_city_citizen_reporting_app",
    "ai_backend",
    "reports.db"
)

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# Show current state before reset
cur.execute("SELECT id, status FROM reports")
rows = cur.fetchall()
print(f"Found {len(rows)} report(s):")
for r in rows:
    print(f"  ID {r[0]} -> {r[1]}")

# Reset all reports to Pending, clear all workflow fields
cur.execute("""
    UPDATE reports SET
        status                  = 'Pending',
        assigned_department     = NULL,
        authority_notes         = NULL,
        forwarded_at            = NULL,
        reviewed_at             = NULL,
        assigned_worker         = NULL,
        in_process_at           = NULL,
        in_maintenance_at       = NULL,
        completion_image_path   = NULL,
        completion_notes        = NULL,
        completion_submitted_at = NULL,
        worker_completed        = 0,
        resolved_at             = NULL
""")

conn.commit()
affected = conn.total_changes
conn.close()

print(f"\nDone! {affected} report(s) reset to 'Pending'.")
