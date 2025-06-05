# Rafted: A Raft Consensus Protocol Implementation

## Project Overview

This project is an implementation of the Raft consensus protocol, developed as part of the IF3130 Parallel and Distributed Systems course. The primary goal is to create a fault-tolerant, distributed key-value in-memory storage system. The system ensures data consistency across multiple nodes even in the presence of node failures or network partitions.

## Core Features

The Raft implementation includes the following key features as required:

* **Leader Election**: Dynamically elects a leader node and handles leader failover.
* **Log Replication**: Ensures that all nodes in the cluster have a consistent log of operations, replicated from the leader.
* **Heartbeat Mechanism**: The leader periodically sends heartbeats to followers to maintain authority and signal presence.
* **Membership Change**: Supports dynamic addition and removal of nodes from the cluster via client commands.

The distributed application built on top of this Raft implementation is a key-value store with the following operations:

* `set <key> <value>`: Sets a key to a string value.
* `get <key>`: Retrieves the string value of a key. Returns an empty string if the key doesn't exist.
* `del <key>`: Deletes a key-value pair and returns the deleted value. Returns an empty string if the key didn't exist[cite: 77].
* `append <key> <value>`: Appends a string value to an existing key's value. If the key doesn't exist, it's created with an empty string before appending.
* `strln <key>`: Returns the length of the string value associated with a key.
* `ping`: Checks connectivity with the server; the server responds with "PONG".

## Technology Stack

* **Language**: TypeScript 
* **Runtime**: Node.js 
* **Framework/Libraries**:
    * Express.js: For handling client HTTP requests and server-to-server API communication (non-RPC).
    * Jayson: For JSON-RPC communication between Raft nodes.
    * Axios: For making HTTP requests (client-to-server and server-to-server for RPC).
    * Jest: For unit testing.
* **Containerization**: Docker, Docker Compose.

## Implementation Details

The system is built around a `RaftNode` class that encapsulates the Raft consensus logic. Each server instance runs a `RaftNode`.

### Node Roles and Terms
Nodes operate in one of three roles: **Follower**, **Candidate**, or **Leader**. The system progresses in **terms**, each identified by a monotonically increasing integer. Each term has at most one leader[cite: 112].

### Heartbeats
The Leader maintains its authority by periodically sending `AppendEntries` RPCs (which act as heartbeats) to all Followers. This is handled by the `startHeartbeat` method in `RaftNode.ts`, which uses `setInterval`. Followers reset their election timeout upon receiving a valid heartbeat, preventing them from starting new elections. The visibility of heartbeat logs can be toggled.

### Leader Election
If a Follower does not receive a heartbeat within its randomized **election timeout** (defined by `BASE_ELECTION_TIMEOUT_MIN` and `BASE_ELECTION_TIMEOUT_MAX` in `RaftNode.ts`), it transitions to Candidate, increments the current term, votes for itself, and sends `RequestVote` RPCs to other nodes. A candidate becomes Leader if it receives votes from a majority of nodes. If an election results in a split vote, the election times out, and a new election begins with an incremented term. The `electionBackoffMultiplier` is used to reduce the chance of repeated split votes by increasing the timeout range.

### Log Replication
Client commands (e.g., `set`, `del`) are forwarded to the Leader. The Leader appends the command to its local log (`this.log` in `RaftNode.ts`). These log entries are then replicated to Followers via `AppendEntries` RPCs. An entry is considered **committed** when the Leader determines it has been replicated to a majority of servers (tracked via `matchIndex` and `commitIndex`). Once committed, the Leader applies the command to its state machine (the `KVStore`) and responds to the client. Followers apply committed entries in the order they appear in the log.

### State Machine (Key-Value Store)
The application is a distributed in-memory key-value store, implemented in `KVStore.ts`. It supports `set`, `get`, `del`, `append`, and `strlen` operations. The `RaftNode` applies commands to its `KVStore` instance once they are committed in the Raft log, via the `applyLogEntry` method.

### Membership Changes
Nodes can be added to or removed from the cluster dynamically. This implementation uses a **joint consensus** approach for safety during configuration changes, as detailed in the Raft paper's section on cluster membership changes.
1.  The Leader receives a request to add or remove a node (e.g., via `/join-cluster` or `/remove-member` HTTP endpoints handled by `ClientHandler.ts`).
2.  The Leader creates a log entry for the "joint configuration" (`config:joint:Cold,Cnew|Cnew`) which includes both the old and new sets of peers. Decisions during this phase require majorities from *both* old and new configurations.
3.  Once the joint configuration entry is committed, the Leader creates a log entry for the "new configuration" (`config:new:Cnew`).
4.  Once the new configuration entry is committed, the membership change is complete, and the system transitions to using only the new configuration for consensus.
5.  Nodes removed from the cluster via this mechanism will shut themselves down after applying the new configuration log entry that excludes them.

### Inter-Node Communication (RPC)
Communication between Raft nodes (server-to-server) for consensus purposes (like `RequestVote` and `AppendEntries`) is handled using **JSON-RPC*.
* **RPC Server:** Each `RaftNode` hosts an RPC server using the `jayson` library. This is set up in `RPCHandler.ts` and mounted on the `/rpc` HTTP endpoint in `Server.ts`.
    * It exposes two main RPC methods:
        * `requestVote(params)`: Called by Candidates to request votes.
        * `appendEntries(params)`: Called by the Leader to replicate log entries and as a heartbeat.
* **RPC Client (Node-to-Node):** When a `RaftNode` needs to send an RPC to another node, it uses `axios.post` to make an HTTP POST request to the target node's `/rpc` endpoint with the appropriate JSON-RPC payload. This is seen in methods like `startHeartbeat`, `sendAppendEntriesNow`, and `requestVotes` in `RaftNode.ts`.

### Client-Server Communication
Clients interact with the Raft cluster via a standard HTTP API exposed by each server node using Express.js.
* The `RaftClient.ts` class encapsulates client-side logic, including sending commands and handling leader redirection.
* Key client-facing HTTP endpoints are defined in `Server.ts` and handled by `ClientHandler.ts`:
    * `POST /execute`: For KV store operations (ping, get, set, etc.).
    * `GET /request_log`: To retrieve the Leader's log.
    * `POST /join-cluster`, `POST /remove-member`: For initiating membership changes.
    * `GET /status`: To get node status information.
* If a client sends a request (e.g., to `/execute`) to a Follower node, the follower responds with a 403 status and includes the current leader's ID and address in the response body. The `RaftClient` then automatically redirects the request to the identified leader.

### Initialization
Servers are initialized with a fixed list of peers. If a node starts with no peers, it bootstraps itself as a single-node cluster (becomes leader immediately). Otherwise, it initializes its log with the initial cluster configuration. The client initializes by connecting to a seed node to discover the current leader and other peers.

---

## Prerequisites

* Node.js (v18 or later recommended)
* npm (usually comes with Node.js)
* Docker & Docker Compose (for containerized deployment and demo)

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/labsister21/tugas-besar-sister-onewithoutcuda.git
    cd tugas-besar-sister-onewithoutcuda
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
---

## Running the Project

You can run the Raft cluster using Docker (recommended for ease of setup and demo) or manually using Node.js.

### Using Docker (Recommended)

This project uses Docker to simplify the setup of a multi-node cluster and to simulate network conditions as required for the demo.

1.  **Build Docker Images:**
    Ensure you are in the project's root directory.
    ```bash
    docker build -f Dockerfile.server -t raft-server .
    docker build -f Dockerfile.client -t raft-client .
    ```

2.  **Run with Docker Compose:**
    The `docker-compose.yaml` file is configured to start 5 server nodes (`node1` to `node5`) on a dedicated network (`raftnet`).
    ```bash
    docker-compose up -d
    ```
    * `node1` through `node4` will attempt to form a cluster.
    * `node5` starts as an isolated node, which can be added to the cluster later for the membership change demo.
    * Each server node includes `NET_ADMIN` capability to allow network manipulation with `tc` for demo purposes.

3.  **Check Node Logs:**
    ```bash
    docker-compose logs -f node1
    docker-compose logs -f node2
    # ... and so on for other nodes
    ```

4.  **Run the Client:**
    To interact with the cluster, run the client Docker container:
    ```bash
    # The network name might be <project_directory_name>_raftnet if docker-compose prepends it.
    # Check with `docker network ls`. Assuming it's 'tugas-besar-sister-onewithoutcuda_raftnet' or just 'raftnet'.
    # If you created 'raftnet' manually as per run.sh, use that.
    docker run -it --rm --name raft_cli --network tugas-besar-sister-onewithoutcuda_raftnet --cap-add=NET_ADMIN raft-client node1:8081
    ```
    Replace `tugas-besar-sister-onewithoutcuda_raftnet` with the actual network name if different. The client will initialize by contacting `node1:8081`.

5.  **Alternative Server Startup (using `run.sh`):**
    The `run.sh` script also starts the 5 server nodes in detached mode after ensuring the `raftnet` network exists. Make sure images are built first.
    ```bash
    ./run.sh
    ```

### Manually with Node.js (for development/testing)

1.  **Build the project first:** `npm run build`

2.  **Start Server Nodes:**
    Open multiple terminal windows.
    * **Node 1 (Initial Leader Candidate):**
        ```bash
        npm run server:start -- node1 8081 localhost node2:8082,node3:8083,node4:8084
        ```
    * **Node 2:**
        ```bash
        npm run server:start -- node2 8082 localhost node1:8081,node3:8083,node4:8084
        ```
    * **Node 3:**
        ```bash
        npm run server:start -- node3 8083 localhost node1:8081,node2:8082,node4:8084
        ```
    * **Node 4:**
        ```bash
        npm run server:start -- node4 8084 localhost node1:8081,node2:8082,node3:8083
        ```
    * **Node 5 (Isolated, for later joining):**
        ```bash
        npm run server:start -- node5 8085 localhost
        ```
    The server script `dist/index-server.js` takes arguments: `<nodeId> <port> [host] [peers_comma_separated]`.

3.  **Start the Client:**
    In another terminal:
    ```bash
    npm run client:start -- localhost:8081
    ```
    The client script `dist/index-client.js` takes a seed node address as an argument.

---

## Client Commands

Once the client is running, you can use the following commands:

* **Key-Value Operations:**
    * `set <key> <value>`: Set a key to a value.
    * `get <key>`: Get the value of a key.
    * `del <key>`: Delete a key.
    * `append <key> <value>`: Append a value to a key.
    * `strln <key>`: Get the length of the value stored in a key.
* **Cluster Management:**
    * `add-member <host:port>`: Add a new node to the cluster.
    * `remove-member <host:port>`: Remove a node from the cluster.
    * `peers`: Show current known peers from the client's perspective (refreshes from leader).
* **Monitoring & Debugging:**
    * `status [host:port]`: Get the status of a specific node (if address provided) or the current leader.
    * `request-log`: Get log entries from the current leader node.
    * `ping`: Ping the current leader node.
    * `show-heartbeat`: Enable heartbeat visibility in server logs.
    * `hide-heartbeat`: Disable heartbeat visibility in server logs.
* **Client Internal State:**
    * `status-client`: Show current client data (leader, known nodes).
    * `refresh-client`: Refresh client data by querying the leader.
    * `set-leader <host:port>`: Manually set the leader address for the client.
* **Other:**
    * `help`: Show the help menu.
    * `exit`: Exit the CLI.

If a command is sent to a follower, the follower will reject it and provide the leader's address; the client will automatically retry the command with the leader.

---

## Testing

Unit tests are implemented using Jest.

* To run all tests:
    ```bash
    npm test
    ```
   
* Test files are located in `src/__tests__/`. Current tests cover:
    * `KVStore` functionality (`kvstore.test.ts`).
    * Core `RaftNode` logic including election, append entries, and log application (`raftNode.test.ts`).

---

## Project Structure

* `src/`: Contains the TypeScript source code.
    * `raft/RaftNode.ts`: Core Raft consensus logic.
    * `kvstore/KVStore.ts`: In-memory key-value store implementation.
    * `server/`: Contains server-side logic.
        * `Server.ts`: Express server setup, initializes RaftNode, defines HTTP routes.
        * `ClientHandler.ts`: Handles HTTP requests from clients (e.g., execute commands, join cluster).
        * `RPCHandler.ts`: Handles JSON-RPC requests between Raft nodes (e.g., requestVote, appendEntries).
    * `client/RaftClient.ts`: Logic for the command-line client.
    * `index-server.ts`: Entry point for server nodes.
    * `index-client.ts`: Entry point for the CLI client.
    * `utils/Logger.ts`: Simple logger utility.
    * `types/`: TypeScript type definitions.
    * `__tests__/`: Unit tests.
* `dist/`: Compiled JavaScript code (generated by `npm run build`).
* `Dockerfile.server` & `Dockerfile.client`: Dockerfiles for server and client images.
* `docker-compose.yaml`: Docker Compose configuration for multi-node deployment.
* `entrypoint-server.sh` & `entrypoint-client.sh`: Scripts run inside Docker containers, include `tc` commands for network simulation.
* `run.sh`: Utility script to start server nodes using Docker.
* `package.json`: Project metadata, dependencies, and scripts.
* `tsconfig.json`: TypeScript compiler options.
* `jest.config.js`: Jest configuration.

## Bonus Features

* **Unit Tests (Implemented)**: Comprehensive unit tests for `KVStore` and `RaftNode` are included.

---

## Group Member

| NIM      | Nama                    |
| :------- | :---------------------- |
| 13522021 | Filbert                 |
| 13522111 | Ivan Hendrawan Tan      |
| 13522117 | Mesach Hermasendro      |

## References
* Raft Website: https://raft.github.io/ 
* Original Raft Paper: https://raft.github.io/raft.pdf 
* Raft Visualization: http://thesecretlivesofdata.com/raft/ 
* Raft Wikipedia: https://www.wikiwand.com/en/Raft_(algorithm) 
* Cambridge Distributed Systems Notes: https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf 
* HashiCorp Raft Membership Change: https://github.com/hashicorp/raft/blob/main/membership.md 
