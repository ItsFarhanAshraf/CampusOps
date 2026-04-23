"""One-off: ensure application database exists (connects to maintenance DB 'postgres')."""
import os
import sys

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

DB_NAME = os.environ.get("POSTGRES_DB", "campusops")


def main() -> int:
    conn = psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "postgres"),
        password=os.environ.get("POSTGRES_PASSWORD", ""),
        dbname="postgres",
    )
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DB_NAME,))
    if cur.fetchone():
        print(f"Database {DB_NAME!r} already exists.")
    else:
        cur.execute(f'CREATE DATABASE "{DB_NAME}"')
        print(f"Created database {DB_NAME!r}.")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
