#!/bin/bash

set -e

NETWORK_NAME="raftnet"

if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  echo "Creating network $NETWORK_NAME..."
  docker network create "$NETWORK_NAME"
else
  echo "Network $NETWORK_NAME already exists."
fi

echo "Starting 5 Raft server nodes..."

docker run -d --rm --name node1 --net $NETWORK_NAME --cap-add=NET_ADMIN \
  raft-server node1 8081 node1 node2:8082,node3:8083,node4:8084,node5:8085

docker run -d --rm --name node2 --net $NETWORK_NAME --cap-add=NET_ADMIN \
  raft-server node2 8082 node2 node1:8081,node3:8083,node4:8084,node5:8085

docker run -d --rm --name node3 --net $NETWORK_NAME --cap-add=NET_ADMIN \
  raft-server node3 8083 node3 node1:8081,node2:8082,node4:8084,node5:8085

docker run -d --rm --name node4 --net $NETWORK_NAME --cap-add=NET_ADMIN \
  raft-server node4 8084 node4 node1:8081,node2:8082,node3:8083,node5:8085

docker run -d --rm --name node5 --net $NETWORK_NAME --cap-add=NET_ADMIN \
  raft-server node5 8085 node5 node1:8081,node2:8082,node3:8083,node4:8084

echo "Launching interactive Raft CLI client (connected to node1:8081)..."
docker run -it --rm --name raft_client --cap-add=NET_ADMIN  --net $NETWORK_N raft-client node1:8081 
