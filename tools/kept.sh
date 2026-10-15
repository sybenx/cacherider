#!/bin/sh
# After a tool in a workflow step fails (tools/upstream.py's exit, then the file it writes, then what to say):
# the file put back as it was, and the run told which way it went.
#   75: its source couldn't be reached, or answered nothing worth keeping. Yesterday's file stands; the step is green.
#   anything else: the tool broke. Yesterday's file stands, the night's other data still goes up, and the run ends
#   red at its last step (BROKE), so someone hears of it. Each step used to end `|| echo 'unreachable'`, and a tool
#   that crashed every night stayed green, its data frozen.
code=$1; file=$2; note=$3
git checkout -- "$file"
if [ "$code" = 75 ]; then echo "$note"; exit 0; fi
echo "::error::$file: its tool failed (exit $code); the last one is kept"
echo "BROKE=${BROKE:+$BROKE }$file" >> "$GITHUB_ENV"
