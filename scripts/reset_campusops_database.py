"""
Development-only: terminate connections, DROP and CREATE POSTGRES_DB.

Loads environment from project root .env (same as Django).
"""
import os
import sys
from pathlib import Path

import psycopg2
from psycopg2 import sql
from dotenv import load_dotenv


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env")
    db = os.environ.get("POSTGRES_DB", "").strip()
    if not db:
        print("POSTGRES_DB is not set; refusing to reset (use SQLite or configure Postgres).", file=sys.stderr)
        return 1
    user = os.environ.get("POSTGRES_USER", "postgres")
    password = os.environ.get("POSTGRES_PASSWORD", "")
    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("POSTGRES_PORT", "5432")
    conn = psycopg2.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        dbname="postgres",
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid();",
        (db,),
    )
    cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(db)))
    cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db)))
    cur.close()
    conn.close()
    print(f"Recreated database {db!r}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
