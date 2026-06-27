# Singapore MRT Route Planner 🚇

A graph-based Singapore MRT Route Planner built in **C++17** that computes optimal travel routes across the MRT network. The application models the transit system as a weighted graph and uses a **line-aware Dijkstra algorithm** to generate multiple route alternatives with minimum travel time and interchanges.

## Features

- Computes up to **6 optimal routes** between any two MRT stations.
- Uses a **line-aware Dijkstra algorithm** for shortest-path computation.
- Supports **direct, single-, and double-interchange** journeys.
- Predicts **train boarding directions** using BFS traversal.
- Displays **estimated travel time** and **number of interchanges**.
- Generates step-by-step passenger instructions including boarding, stops, interchanges, and arrival.
- Loads the complete MRT network from CSV files for easy extensibility.

## Tech Stack

- **Language:** C++17
- **Algorithms:** Dijkstra's Algorithm, Breadth-First Search (BFS)
- **Data Structures:** Graphs (Adjacency Lists), Priority Queue, Hash Maps, Queues

## Project Structure

```
Singapore-MRT-Route-Planner/
│── mrt_router.cpp
│── stations.csv
│── edges.csv
│── lines.csv
└── README.md
```

## Input Files

### stations.csv
Contains MRT station-line nodes.

Example:
```
Bugis~EW
Bugis~DT
City Hall~EW
```

### edges.csv
Contains graph edges and travel times.

Example:
```
NodeA,NodeB,Minutes
Bugis~EW,City Hall~EW,3
```

### lines.csv
Contains terminal stations for each MRT line.

Example:
```
EW,Pasir Ris,Tuas Link
```

## Compilation

Compile using:

```bash
g++ -std=c++17 mrt_router.cpp -o mrt_router
```

## Running

```bash
./mrt_router
```

Enter the source and destination station nodes when prompted.

Example:

```
Source station node:
Bugis~EW

Destination station node:
Jurong East~EW
```

## Sample Output

```
Found 3 route(s)

Route 1
Travel Time: 28 min
Interchanges: 1

BOARD at Bugis
→ Lavender
→ Kallang
INTERCHANGE at City Hall
ARRIVE at Jurong East
```

## Algorithm Overview

1. Load MRT stations, edges, and line information from CSV files.
2. Construct a weighted graph using adjacency lists.
3. Execute a line-aware Dijkstra algorithm to compute shortest routes.
4. Enumerate direct, one-interchange, and two-interchange route alternatives.
5. Use BFS to determine train boarding directions.
6. Generate passenger-friendly travel instructions.

## Complexity

- Graph Construction: **O(V + E)**
- Route Computation: **O((V + E) log V)**
- Path Reconstruction: **O(Path Length)**

## Future Improvements

- Real-time train delays and service updates.
- Fare estimation.
- GUI/Web interface.
- Live MRT API integration.
- Support for additional public transport modes.

## Author

**Aaratrika Bhattacharya**
