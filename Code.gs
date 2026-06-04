// ============================================================
//  Singapore MRT Router — Google Apps Script (Code.gs)
//  FIXED: Properly trace lines through actual path nodes
// ============================================================

/**
 * Entry point for the web UI.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Singapore MRT Router')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─────────────────────────────────────────────────────────────
//  DATA LOADING & INITIALIZATION
// ─────────────────────────────────────────────────────────────

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

function getStationName(nodeName) {
  return nodeName.split('~')[0].trim();
}

function getLineCodes(nodeName) {
  const parts = nodeName.split('~');
  if (parts.length < 2 || !parts[1]) return [];
  return parts[1].split('/').map(code => code.trim());
}

function getPrimaryLine(nodeName) {
  const codes = getLineCodes(nodeName);
  return codes.length > 0 ? codes[0] : "";
}

// ─────────────────────────────────────────────────────────────
//  ADJACENCY LIST BUILDER
// ─────────────────────────────────────────────────────────────

function buildAdjList(data) {
  const adjList = {};

  data.stations.forEach(station => {
    adjList[station] = [];
  });

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
      if (nbrCodes.includes(lineCode) && getStationName(edge.nbr) !== stationName) {
        visited[edge.nbr] = true;
        queue.push(edge.nbr);
      }
    });
  }

  return terminals.t2;
}

// ─────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────

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
//  STRATEGY 1: SHORTEST TIME
// ─────────────────────────────────────────────────────────────

function dijkstraTime(src, dest, adjList, lineTerminals) {
  const dist = {};
  const parent = {};
  const pq = [];

  Object.keys(adjList).forEach(node => {
    dist[node] = Infinity;
  });
  dist[src] = 0;
  pq.push({ node: src, cost: 0 });

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
// ─────────────────────────────────────────────────────────────

function dijkstraInterchanges(src, dest, adjList, lineTerminals) {
  const dist = {};
  const parent = {};
  const pq = [];

  const key = (node, line) => `${node}|${line}`;
  const srcLine = getPrimaryLine(src);
  const startKey = key(src, srcLine);

  dist[startKey] = 0;
  pq.push({ node: src, line: srcLine, cost: 0 });

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
//  FORMAT OUTPUT STEPS - CORRECTLY EXTRACT LINES FROM NODE NAMES
// ─────────────────────────────────────────────────────────────

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

  // ══════════════════════════════════════════════════════════════
  // KEY FIX: Extract line from ACTUAL node name in path
  // Node format: "Jurong East~EW" or "Boon Lay~EW/JE"
  // ══════════════════════════════════════════════════════════════
  
  const pathWithLines = [];
  
  // For first node, determine which line we board
  let boardingLine = getPrimaryLine(path[0]);
  
  // Look ahead to find which line actually connects the first station to the next
  for (let i = 1; i < path.length; i++) {
    if (getStationName(path[i]) !== getStationName(path[0])) {
      // Found different station - the line is whatever connects them
      const prevLines = getLineCodes(path[i - 1]);
      const currLines = getLineCodes(path[i]);
      const commonLine = prevLines.find(l => currLines.includes(l));
      if (commonLine) boardingLine = commonLine;
      break;
    }
  }

  pathWithLines.push({
    node: path[0],
    station: getStationName(path[0]),
    line: boardingLine
  });

  // Process remaining nodes
  for (let i = 1; i < path.length; i++) {
    const prevNode = path[i - 1];
    const currNode = path[i];
    const prevStation = getStationName(prevNode);
    const currStation = getStationName(currNode);

    // Add travel time
    const neighbors = adjList[prevNode] || [];
    const edge = neighbors.find(e => e.nbr === currNode);
    if (edge) {
      totalTravelTime += edge.weight;
    }

    // THE KEY: Get the actual line from the current node name
    let currLine = getPrimaryLine(currNode);
    
    // If different station, verify the line is consistent
    if (currStation !== prevStation) {
      const prevLines = getLineCodes(prevNode);
      const currLines = getLineCodes(currNode);
      const commonLine = prevLines.find(l => currLines.includes(l));
      if (commonLine) {
        currLine = commonLine;
      }
    }

    pathWithLines.push({
      node: currNode,
      station: currStation,
      line: currLine
    });
  }

  // ══════════════════════════════════════════════════════════════
  // COUNT INTERCHANGES: Same station + different line
  // ══════════════════════════════════════════════════════════════
  let interchangeCount = 0;
  for (let i = 1; i < pathWithLines.length; i++) {
    const prev = pathWithLines[i - 1];
    const curr = pathWithLines[i];
    
    // Interchange = same physical station but different line
    if (prev.station === curr.station && prev.line !== curr.line) {
      interchangeCount++;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // BUILD INSTRUCTIONS
  // ══════════════════════════════════════════════════════════════
  
  const initialDirection = getTrainDirection(
    path[0],
    path[1],
    pathWithLines[0].line,
    adjList,
    lineTerminals
  );

  steps.push(
    `🚉 BOARD at ${pathWithLines[0].station} | Line: ${pathWithLines[0].line} | Towards: ${initialDirection}`
  );

  // Display each step
  for (let i = 1; i < pathWithLines.length; i++) {
    const prev = pathWithLines[i - 1];
    const curr = pathWithLines[i];
    const isLastStop = (i === pathWithLines.length - 1);

    if (curr.station === prev.station && curr.line !== prev.line) {
      // ⚡ INTERCHANGE
      let nextDirection = "End of Line";
      for (let j = i + 1; j < pathWithLines.length; j++) {
        if (pathWithLines[j].station !== curr.station) {
          nextDirection = getTrainDirection(
            path[i], 
            path[j], 
            curr.line, 
            adjList, 
            lineTerminals
          );
          break;
        }
      }

      steps.push(
        `⚡ INTERCHANGE at ${curr.station} | Switch from Line ${prev.line} to Line ${curr.line} | Train towards: ${nextDirection}`
      );

      if (isLastStop) {
        steps.push(`🏁 ARRIVE at ${curr.station}`);
      }
    } else if (curr.station !== prev.station) {
      // → NORMAL STOP
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
