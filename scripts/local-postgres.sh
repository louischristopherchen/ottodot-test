#!/bin/sh
# Project-local Postgres for development and tests.
#
# Data lives in .pgdata/ (git-ignored), the server listens on 127.0.0.1 only and
# local connections are trusted, so no password is needed and the machine's own
# Postgres is never touched. Point DATABASE_URL at any other Postgres to skip this.
#
# Usage: sh scripts/local-postgres.sh start|stop|status
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA="$ROOT/.pgdata"
PORT="${LOCAL_PG_PORT:-55432}"
DATABASES="trial_booking trial_booking_test trial_booking_e2e"

require() {
	command -v "$1" >/dev/null 2>&1 || {
		echo "$1 not found. Install PostgreSQL 14+ (brew install postgresql@16, apt install postgresql) or set DATABASE_URL to an existing server." >&2
		exit 1
	}
}

start() {
	require initdb
	require pg_ctl
	if [ ! -f "$DATA/PG_VERSION" ]; then
		initdb -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
	fi
	if ! pg_ctl -D "$DATA" status >/dev/null 2>&1; then
		pg_ctl -D "$DATA" -l "$DATA/server.log" -w \
			-o "-p $PORT -c listen_addresses=127.0.0.1 -k $DATA" start >/dev/null
	fi
	for db in $DATABASES; do
		exists=$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'")
		[ "$exists" = "1" ] || createdb -h 127.0.0.1 -p "$PORT" -U postgres "$db"
	done
	echo "Postgres is running on 127.0.0.1:$PORT (databases: $DATABASES)"
}

stop() {
	if pg_ctl -D "$DATA" status >/dev/null 2>&1; then
		pg_ctl -D "$DATA" -m fast -w stop >/dev/null
	fi
	echo "Postgres stopped"
}

case "${1:-}" in
	start) start ;;
	stop) stop ;;
	status) pg_ctl -D "$DATA" status ;;
	*)
		echo "usage: $0 start|stop|status" >&2
		exit 2
		;;
esac
