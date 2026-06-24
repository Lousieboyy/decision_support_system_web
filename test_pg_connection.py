"""
test_pg_connection.py
Tests the PostgreSQL connection to smart_city_db and lists existing tables.
"""
import sys

try:
    import psycopg2
except ImportError:
    print("psycopg2 not installed. Installing...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary"])
    import psycopg2

try:
    conn = psycopg2.connect(
        host="localhost",
        database="smart_city_db",
        user="postgres",
        password="abc123"
    )
    cur = conn.cursor()

    cur.execute("SELECT version();")
    version = cur.fetchone()
    print("=" * 50)
    print("SUCCESS! Connected to PostgreSQL.")
    print(f"Version: {version[0]}")
    print("=" * 50)

    cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
    """)
    tables = cur.fetchall()
    if tables:
        print(f"\nTables in 'smart_city_db' ({len(tables)} found):")
        for t in tables:
            print(f"  - {t[0]}")
            cur.execute(f"SELECT COUNT(*) FROM {t[0]};")
            count = cur.fetchone()[0]
            print(f"      rows: {count}")
    else:
        print("\nNo tables found yet in 'smart_city_db'.")
        print("Run the FastAPI backend once to auto-create tables via SQLAlchemy.")

    cur.close()
    conn.close()
    print("\nConnection closed successfully.")

except psycopg2.OperationalError as e:
    print(f"\nERROR: Could not connect to PostgreSQL.")
    print(f"Details: {e}")
    print("\nTroubleshooting tips:")
    print("  1. Make sure PostgreSQL service is running.")
    print("  2. Verify the database 'smart_city_db' exists.")
    print("  3. Confirm user 'postgres' has access with password 'abc123'.")
except Exception as e:
    print(f"\nUnexpected error: {e}")
