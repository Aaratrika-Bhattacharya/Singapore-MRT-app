// ============================================================
//  Singapore MRT Router — Google Apps Script (Code.gs)
//  IMPROVED VERSION: Better structure, error handling, and documentation
// ============================================================

/**
 * Entry point for the web UI.
 * Serves the Index.html file as the main interface.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Singapore MRT Router')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─────────────────────────────────────────────────────────────
//  DATA LOADING & INITIALIZATION
// ─────────────────────────────────────────────────────────────

/**
 * Loads all MRT graph data from the spreadsheet.
 * Expected sheets: "Stations", "Edges", "Lines"
 * @returns {Object} Object with stations array, edges array, and line terminals
 */
function getGraphData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stSheet = ss.getSheetByName("Stations");
  const edgesSheet = ss.getSheetByName("Edges");
  const linesSheet = ss.getSheetByName("Lines");

  if (!stSheet || !edgesSheet || !linesSheet) {
    throw new Error("Required sheets not found: Stations, Edges, and Lines");
  }

  const stations = stSheet
    .getRange(2, 1, stSheet.getLastRow() - 1, 1)
    .getValues()
    .map(r => r[0].toString().trim())
    .filter(s => s.length > 0);

  const edges = edgesSheet
    .getRange(2, 1, edgesSheet.getLastRow() - 1, 3)
    .getValues()
    .filter(row => row[0] && row[1] && row[2]);

  const linesData = linesSheet
    .getRange(2, 1, linesSheet.getLastRow() - 1, 3)
    .getValues()
    .filter(row => row[0] && row[1] && row[2]);

  const lineTerminals = {};
  linesData.forEach(row => {
    lineTerminals[row[0].toString().trim()] = {
      t1: row[1].toString().trim(),
      t2: row[2].toString().trim()
    };
  });

  return { stations, edges, lineTerminals };
}

// ─────────────────────────────────────────────────────────────
//  UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

/**
 * Extracts the physical station name from a node identifier.
 * Example: "Jurong East~EW" → "Jurong East"
 */
function getStationName(nodeName) {
  return nodeName.split('~')[0].trim();
}

/**
 * Extracts line codes from a node identifier.
 * Example: "Jurong East~EW/NS" → ["EW", "NS"]
 */
function getLineCodes(nodeName) {
  const parts = nodeName.split('~');
  if (parts.length < 2 || !parts[1]) return [];
  return parts[1].split('/').map(code => code.trim());
}

/**
 * Gets the primary (first) line code of a node.
 */
function getPrimaryLine(nodeName) {
  const codes = getLineCodes(nodeName);
  return codes.length > 0 ? codes[0] : "";
}

/**
 * Checks if an edge connects two nodes at the same physical station
 * but on different lines (a transfer edge).
 */
function isTransferEdge(nodeA, nodeB) {
  if (getStationName(nodeA) !== getStationName(nodeB)) return false;
  const linesA = getLineCodes(nodeA);
  const linesB = getLineCodes(nodeB);
  // Transfer if they DON'T share any line codes
  return !linesA.some(line => linesB.includes(line));
}

// ─────────────────────────────────────────────────────────────
//  ADJACENCY LIST BUILDER
// ─────────────────────────────────────────────────────────────

/**
 * Builds an adjacency list representation of the MRT network.
 * @param {Object} data - Graph data from getGraphData()
 * @returns {Object} Adjacency list where each node maps to array of {nbr, weight}
 */
function buildAdjList(data) {
  const adjList = {};

  // Initialize all stations
  data.stations.forEach(station => {
    adjList[station] = [];
  });

  // Add edges (bidirectional)
  data.edges.forEach(edge => {
    const [u, v, w] = [edge[0].toString().trim(), edge[1].toString().trim(), Number(edge[2])];
    if (adjList[u] && adjList[v]) {
      adjList[u].push({ nbr: v, weight: w });
      adjList[v].push({ nbr: u, weight: w });
    }
  });

  return adjList;
}

// ─────────────────────────────────────────────────────────────
//  TRAIN DIRECTION FINDER
// ─────────────────────────────────────────────────────────────

/**
 * Determines which direction the train is heading on a given line.
 * Uses BFS to find which terminal station we're heading towards.
 */
function getTrainDirection(currentNode, nextNode, lineCode, adjList, lineTerminals) {
  const terminals = lineTerminals[lineCode];
  if (!terminals) return "Unknown";

  const visited = {};
  const queue = [nextNode];
  visited[currentNode] = true;
  visited[nextNode] = true;

  while (queue.length > 0) {
    const curr = queue.shift();
    const stationName = getStationName(curr);

    if (stationName === terminals.t1) return terminals.t1;
    if (stationName === terminals.t2) return terminals.t2;

    const neighbors = adjList[curr] || [];
    neighbors.forEach(edge => {
      if (visited[edge.nbr]) return;
      const nbrCodes = getLineCodes(edge.nbr);
      // Only follow edges on the same line and different stations
      if (nbrCodes.includes(lineCode) && getStationName(edge.nbr) !== stationName) {
        visited[edge.nbr] = true;
        queue.push(edge.nbr);
      }
    });
  }

  return terminals.t2; // Default to second terminal
}

// ─────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────

/**
 * Main entry point for calculating routes.
 * @param {string} src - Source station node
 * @param {string} dest - Destination station node
 * @param {string} strategy - "time" or "interchanges"
 * @returns {Object} Route result with steps, metric, interchanges, and total time
 */
function calculateRoute(src, dest, strategy) {
  try {
    const data = getGraphData();
    const adjList = buildAdjList(data);

    src = src.toString().trim();
    dest = dest.toString().trim();

    if (!adjList[src]) {
      return { error: `Source station not found: ${src}` };
    }
    if (!adjList[dest]) {
      return { error: `Destination station not found: ${dest}` };
    }
    if (src === dest) {
      return {
        path: [`🏁 You are already at ${getStationName(src)}`],
        metric: "0 min",
        totalTime: "0 min",
        interchanges: 0
      };
    }

    if (strategy === "time") {
      return dijkstraTime(src, dest, adjList, data.lineTerminals);
    } else if (strategy === "interchanges") {
      return dijkstraInterchanges(src, dest, adjList, data.lineTerminals);
    } else {
      return { error: `Unknown strategy: ${strategy}` };
    }
  } catch (e) {
    return { error: `Error: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────
//  STRATEGY 1: SHORTEST TIME (Dijkstra on travel weight)
// ─────────────────────────────────────────────────────────────

/**
 * Finds the path with minimum travel time.
 * Uses standard Dijkstra's algorithm on edge weights.
 */
function dijkstraTime(src, dest, adjList, lineTerminals) {
  const dist = {};
  const parent = {};
  const pq = [];

  // Initialize distances
  Object.keys(adjList).forEach(node => {
    dist[node] = Infinity;
  });
  dist[src] = 0;
  pq.push({ node: src, cost: 0 });

  // Dijkstra's algorithm
  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const { node: curr, cost: currCost } = pq.shift();

    if (curr === dest) break;
    if (currCost > dist[curr]) continue;

    (adjList[curr] || []).forEach(edge => {
      const newCost = currCost + edge.weight;
      if (newCost < dist[edge.nbr]) {
        dist[edge.nbr] = newCost;
        parent[edge.nbr] = curr;
        pq.push({ node: edge.nbr, cost: newCost });
      }
    });
  }

  if (dist[dest] === Infinity) {
    return { error: "No path found between stations." };
  }

  // Reconstruct path
  const rawPath = [];
  let cur = dest;
  while (cur !== undefined) {
    rawPath.push(cur);
    cur = parent[cur];
  }
  rawPath.reverse();

  return formatSteps(rawPath, dist[dest], "min", adjList, lineTerminals);
}

// ─────────────────────────────────────────────────────────────
//  STRATEGY 2: FEWEST INTERCHANGES
//
//  State: (node, line) pairs
//  An interchange occurs when the physical station stays the same
//  but the line code changes.
// ─────────────────────────────────────────────────────────────

/**
 * Finds the path with minimum number of interchange transfers.
 * Uses modified Dijkstra with state = (node, line).
 */
function dijkstraInterchanges(src, dest, adjList, lineTerminals) {
  const dist = {};
  const parent = {};
  const pq = [];

  const key = (node, line) => `${node}|${line}`;
  const srcLine = getPrimaryLine(src);
  const startKey = key(src, srcLine);

  dist[startKey] = 0;
  pq.push({ node: src, line: srcLine, cost: 0 });

  // Dijkstra with state tracking
  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const curr = pq.shift();
    const currKey = key(curr.node, curr.line);

    if (curr.node === dest) break;
    if (curr.cost > (dist[currKey] ?? Infinity)) continue;

    (adjList[curr.node] || []).forEach(edge => {
      const nbrLine = getPrimaryLine(edge.nbr);
      const isRealTransfer = 
        getStationName(edge.nbr) === getStationName(curr.node) &&
        nbrLine !== curr.line &&
        curr.line !== "" &&
        nbrLine !== "";

      const newCost = curr.cost + (isRealTransfer ? 1 : 0);
      const nbrKey = key(edge.nbr, nbrLine);

      if ((dist[nbrKey] ?? Infinity) > newCost) {
        dist[nbrKey] = newCost;
        parent[nbrKey] = { node: curr.node, line: curr.line };
        pq.push({ node: edge.nbr, line: nbrLine, cost: newCost });
      }
    });
  }

  // Find best destination state
  let bestKey = null;
  let bestCost = Infinity;
  Object.keys(dist).forEach(k => {
    if (k.startsWith(`${dest}|`) && dist[k] < bestCost) {
      bestCost = dist[k];
      bestKey = k;
    }
  });

  if (bestKey === null) {
    return { error: "No path found between stations." };
  }

  // Reconstruct path
  const statePath = [];
  let curKey = bestKey;
  while (curKey) {
    const [node, line] = curKey.split('|');
    statePath.push({ node, line });
    const p = parent[curKey];
    curKey = p ? key(p.node, p.line) : null;
  }
  statePath.reverse();

  const nodePath = statePath.map(s => s.node);
  return formatSteps(nodePath, bestCost, "interchange(s)", adjList, lineTerminals);
}

// ─────────────────────────────────────────────────────────────
//  FORMAT OUTPUT STEPS - STORE LINES AND COUNT CHANGES CORRECTLY
//  Converts node path into human-readable instructions with emoji.
// ─────────────────────────────────────────────────────────────

/**
 * Formats a node path into human-readable step-by-step instructions.
 * Stores line for each node and counts actual line changes.
 * @param {Array} path - Array of node identifiers
 * @param {number} costValue - Total cost (time or interchange count)
 * @param {string} unit - Unit label ("min" or "interchange(s)")
 * @param {Object} adjList - Adjacency list
 * @param {Object} lineTerminals - Line terminal information
 * @returns {Object} Formatted result with path, metric, interchanges, and total time
 */
function formatSteps(path, costValue, unit, adjList, lineTerminals) {
  if (path.length === 0) {
    return { error: "Empty path." };
  }

  const steps = [];
  let totalTravelTime = 0;

  if (path.length === 1) {
    steps.push(`🏁 You are already at ${getStationName(path[0])}`);
    return { 
      path: steps, 
      metric: "0 min", 
      totalTime: "0 min",
      interchanges: 0 
    };
  }

  // ── Store path with line information: array of {node, station, line} ──
  const pathWithLines = [];
  let currentLine = getPrimaryLine(path[0]);

  // Find the actual boarding line by looking at the path
  for (let i = 1; i < path.length; i++) {
    if (getStationName(path[i]) !== getStationName(path[0])) {
      currentLine = getPrimaryLine(path[i - 1]);
      break;
    }
  }

  pathWithLines.push({
    node: path[0],
    station: getStationName(path[0]),
    line: currentLine
  });

  // Build the rest of the path with lines
  for (let i = 1; i < path.length; i++) {
    const currStation = getStationName(path[i]);
    const prevStation = getStationName(path[i - 1]);

    // Calculate travel time
    const neighbors = adjList[path[i - 1]] || [];
    const edge = neighbors.find(e => e.nbr === path[i]);
    if (edge) {
      totalTravelTime += edge.weight;
    }

    // Determine the line at this node
    let nodeLine = getPrimaryLine(path[i]);

    // If same station, check if we need to change lines
    if (currStation === prevStation) {
      // This is an interchange station - use the primary line of this node
      nodeLine = getPrimaryLine(path[i]);
    } else {
      // Different station - keep the same line we were on
      // unless the node doesn't have that line
      const nodeLines = getLineCodes(path[i]);
      if (!nodeLines.includes(currentLine)) {
        // Find compatible line
        const prevLines = getLineCodes(path[i - 1]);
        nodeLine = nodeLines.find(l => prevLines.includes(l)) || nodeLine;
      } else {
        nodeLine = currentLine;
      }
    }

    currentLine = nodeLine;
    pathWithLines.push({
      node: path[i],
      station: currStation,
      line: nodeLine
    });
  }

  // ── Count actual line changes by comparing consecutive lines ──
  let interchangeCount = 0;
  for (let i = 1; i < pathWithLines.length; i++) {
    const prevLine = pathWithLines[i - 1].line;
    const currLine = pathWithLines[i].line;
    const prevStation = pathWithLines[i - 1].station;
    const currStation = pathWithLines[i].station;

    // Line change happens when: same station but different line
    if (prevStation === currStation && prevLine !== currLine) {
      interchangeCount++;
    }
  }

  // ── Build step-by-step instructions ──
  currentLine = pathWithLines[0].line;
  
  const initialDirection = getTrainDirection(
    path[0],
    path[1],
    currentLine,
    adjList,
    lineTerminals
  );

  steps.push(
    `🚉 BOARD at ${pathWithLines[0].station} | Line: ${currentLine} | Towards: ${initialDirection}`
  );

  // Walk through path and display steps
  for (let i = 1; i < pathWithLines.length; i++) {
    const prev = pathWithLines[i - 1];
    const curr = pathWithLines[i];
    const isLastStop = (i === pathWithLines.length - 1);

    if (curr.station === prev.station && curr.line !== prev.line) {
      // This is an interchange
      const newLine = curr.line;
      currentLine = newLine;

      // Find next different station for direction
      let nextDifferentStation = null;
      for (let j = i + 1; j < pathWithLines.length; j++) {
        if (pathWithLines[j].station !== curr.station) {
          nextDifferentStation = pathWithLines[j];
          break;
        }
      }

      const newDirection = nextDifferentStation
        ? getTrainDirection(path[i], path[pathWithLines.indexOf(nextDifferentStation)], newLine, adjList, lineTerminals)
        : "End of Line";

      steps.push(
        `⚡ INTERCHANGE at ${curr.station} | Switch from Line ${prev.line} to Line ${newLine} | Train towards: ${newDirection}`
      );

      if (isLastStop) {
        steps.push(`🏁 ARRIVE at ${curr.station}`);
      }
    } else if (curr.station !== prev.station) {
      // Normal stop at different station
      if (isLastStop) {
        steps.push(`🏁 ARRIVE at ${curr.station}`);
      } else {
        steps.push(`  ➔ ${curr.station} [Line: ${curr.line}]`);
      }
    }
  }

  return {
    path: steps,
    metric: `${costValue} ${unit}`,
    totalTime: `${totalTravelTime} min`,
    interchanges: interchangeCount
  };
}
