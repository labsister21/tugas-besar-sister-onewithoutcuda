network create raft

docker build -f Dockerfile.client -t raft-client .

docker build -f Dockerfile.server -t raft-server .

docker run --rm --name node1 --net raft --cap-add=NET_ADMIN raft-server node1 8081 node1 node2:8082,node3:8083,node4:8084

docker run --rm --name node2 --net raft --cap-add=NET_ADMIN raft-server node2 8082 node2 node1:8081,node3:8083,node4:8084

docker run --rm --name node3 --net raft --cap-add=NET_ADMIN raft-server node3 8083 node3 node1:8081,node2:8082,node4:8084

 docker run --rm --name node4 --net raft --cap-add=NET_ADMIN raft-server node4 8083 node4 node1:8081,node2:8082,node3:8083

docker run -it --rm --name raft_client --net raft --cap-add=NET_ADMIN raft-client node1:8081

docker run -it --rm --name raft_client --net sister-konsensus_raftnet --cap-add=NET_ADMIN raft-client node1:8081

docker exec -it node1 sh
docker exec -it node2 sh
docker exec -it node3 sh
docker exec -it node4 sh

tc qdisc show dev lo
