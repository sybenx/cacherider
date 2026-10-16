#!/bin/sh
# Waits for the smoke test's turn, then runs a command holding it. Every worktree's run serves its app on one port,
# 8795 (playwright.config.js), so two runs at once kill or borrow each other's server: on 2026-10-16 sessions pushing
# within minutes of each other failed one another's runs four times. A run takes the turn, one at a time; a run that
# finds it taken waits, saying whose run it's waiting on. Any run by hand, from tools/smoke:
#   sh wait-turn.sh npx playwright test -g 'search'
# npm test goes through it, and the pre-push hook takes the same turn.
# The turn is a lock on a file in the repository's shared .git (smoke-turn), so every worktree's runs queue on it, and
# the kernel lets it go when its holder ends, however it ends (a failure, Ctrl-C, kill -9): there's never a stale one to
# clear. smoke-turn.owner beside it names whoever has the turn, or had it last.
# With the turn, a server still on the port is one a run left behind when it was cut short ('Process from
# config.webServer was not able to start', the next run stopped before it began): stopped. One serving a run that's
# still going without the turn (a run by hand not through here) is waited for.
[ $# -gt 0 ] || { echo "usage: sh wait-turn.sh command [args…]   e.g. sh wait-turn.sh npx playwright test -g 'search'" >&2; exit 2; }
port=8795
common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || common="${TMPDIR:-/tmp}"
lock="$common/smoke-turn"; owner="$common/smoke-turn.owner"
exec 9>>"$lock" || exit 1   # held on this shell's descriptor 9, closed for the command, so only this shell holds it

take() {   # the turn, waiting at most $1 seconds; 75 when it's someone else's
  if command -v lockf >/dev/null 2>&1; then lockf -s -t "$1" 9
  elif command -v flock >/dev/null 2>&1; then flock -E 75 -w "$1" 9
  else return 0; fi   # neither (not a Mac): no turn to take
}
take 0; got=$?
while [ "$got" = 75 ]; do
  echo "Smoke test: waiting for the run in $(cat "$owner" 2>/dev/null || echo 'another worktree')…"
  take 60; got=$?
done
[ "$got" = 0 ] || { echo "Smoke test: couldn't take the turn ($lock, $got)." >&2; exit 1; }
printf '%s (%s, since %s, pid %s)\n' "${PWD%/tools/smoke}" "$*" "$(date +%H:%M)" "$$" > "$owner.$$" && mv -f "$owner.$$" "$owner"

run_of() {   # the playwright run (its node process) the process $1 serves, while it's still going
  p=$1; i=0
  while [ "${p:-1}" -gt 1 ] && [ $i -lt 12 ]; do
    case "$(ps -o comm= -p "$p")" in node|*/node) case "$(ps -o args= -p "$p")" in *playwright*) echo "$p"; return 0 ;; esac ;; esac
    p="$(ps -o ppid= -p "$p" | tr -d ' ')"; i=$((i + 1))
  done
  return 1
}
where() { w="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"; echo "${w%/tools/smoke}"; }   # its worktree
waited=0; orphan=0
while pids="$(lsof -t -iTCP:$port -sTCP:LISTEN 2>/dev/null)" && [ -n "$pids" ]; do
  for p in $pids; do
    if run="$(run_of "$p")" && [ $waited -lt 1200 ]; then   # twenty minutes is four runs: past that it's hung
      [ $((waited % 60)) = 0 ] && echo "Smoke test: port $port is serving a run that didn't take its turn, in $(where "$run"); waiting for it…"
      waited=$((waited + 1))
    else   # its run is gone: a moment to go with it (a run's end takes its server down), then stopped
      orphan=$((orphan + 1))
      [ $orphan = 3 ] && echo "Smoke test: port $port held by a server a run left behind, in $(where "$p"); stopping it."
      if [ $orphan -ge 8 ]; then kill -9 "$p"; elif [ $orphan -ge 3 ]; then kill "$p"; fi 2>/dev/null
    fi
  done
  sleep 1 9>&-
done

"$@" 9>&-
