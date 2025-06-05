#!/bin/sh

tc qdisc add dev eth0 root netem delay 100ms 50ms reorder 8% corrupt 5% duplicate 2% loss 5%

exec node dist/index-server.js "$@"
