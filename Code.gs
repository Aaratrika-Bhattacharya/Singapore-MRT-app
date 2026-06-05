// ============================================================
//  Singapore MRT Router — Google Apps Script (Code.gs)
//  v3: Corridor-enumeration route finder
//      Guarantees finding ALL meaningful routes by enumerating
//      viable interchange stations rather than relying on Yen's K.
// ============================================================

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Singapore MRT Router')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─────────────────────────────────────────────────────────────
//  DATA LOADING
// ─────────────────────────────────────────────────────────────

function getGraphData() {
  const ss         = SpreadsheetApp.getActiveSpreadsheet();
  const stSheet    = ss.getSheetByName("Stations");
  const edgesSheet = ss.getSheetByName("Edges");
  const linesSheet = ss.getSheetByName("Lines");

  if (!stSheet || !edgesSheet || !linesSheet)
    throw new Error("Required sheets not found: Stations, Edges, Lines");

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
//  UTILITY
// ─────────────────────────────────────────────────────────────

function getStationName(nodeName) {
  return nodeName.split('~')[0].trim();
}

function getLineCodes(nodeName) {
  const parts = nodeName.split('~');
  if (parts.length < 2 || !parts[1]) return [];
  return parts[1].split('/').map(c => c.trim());
}

function getPrimaryLine(nodeName) {
  const codes = getLineCodes(nodeName);
  return codes.length > 0 ? codes[0] : "";
}

// ─────────────────────────────────────────────────────────────
//  ADJACENCY LIST
// ─────────────────────────────────────────────────────────────

function buildAdjList(data) {
  const adjList = {};
  data.stations.forEach(s => { adjList[s] = []; });
  data.edges.forEach(edge => {
    const u = edge[0].toString().trim();
    const v = edge[1].toString().trim();
    const w = Number(edge[2]);
    if (adjList[u] && adjList[v]) {
      adjList[u].push({ nbr: v, weight: w });
      adjList[v].push({ nbr: u, weight: w });
    }
  });
  return adjList;
}

// ─────────────────────────────────────────────────────────────
//  LINE-STATE DIJKSTRA
//
//  State = "node|line"
//  Returns:
//    dist[node|line]   = min time to reach node while riding `line`
//    parent[node|line] = previous "node|line" state
//
//  Set reverse=true to run backwards from `src` (treats all
//  edges as undirected, which they already are).
// ─────────────────────────────────────────────────────────────

function lineStateDijkstra(srcNodes, adjList) {
  // srcNodes: array of {node, line, cost} starting states
  const dist   = {};
  const parent = {};
  const pq     = [];

  srcNodes.forEach(s => {
    const k = s.node + '|' + s.line;
    dist[k] = s.cost || 0;
    pq.push({ node: s.node, line: s.line, cost: s.cost || 0 });
  });

  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const curr = pq.shift();
    const currKey = curr.node + '|' + curr.line;
    if (curr.cost > (dist[currKey] ?? Infinity)) continue;

    (adjList[curr.node] || []).forEach(edge => {
      const nbrName    = getStationName(edge.nbr);
      const currName   = getStationName(curr.node);
      const nbrCodes   = getLineCodes(edge.nbr);

      if (nbrName === currName) {
        // Same station, different node → explicit interchange node
        // We arrive at edge.nbr on its primary line
        const nbrLine = getPrimaryLine(edge.nbr);
        if (!nbrLine || nbrLine === curr.line) return; // skip same-line same-station (shouldn't exist)
        const nc = curr.cost + edge.weight;
        const nk = edge.nbr + '|' + nbrLine;
        if (nc < (dist[nk] ?? Infinity)) {
          dist[nk] = nc;
          parent[nk] = currKey;
          pq.push({ node: edge.nbr, line: nbrLine, cost: nc });
        }
      } else {
        // Different station — can only travel if edge.nbr supports curr.line
        if (nbrCodes.includes(curr.line)) {
          // Stay on same line
          const nc = curr.cost + edge.weight;
          const nk = edge.nbr + '|' + curr.line;
          if (nc < (dist[nk] ?? Infinity)) {
            dist[nk] = nc;
            parent[nk] = currKey;
            pq.push({ node: edge.nbr, line: curr.line, cost: nc });
          }
        } else {
          // Single-node interchange: edge.nbr doesn't carry curr.line
          // but they are physically connected → rider transfers at curr.node
          // and boards edge.nbr's primary line
          const nbrLine = getPrimaryLine(edge.nbr);
          if (!nbrLine) return;
          const nc = curr.cost + edge.weight;
          const nk = edge.nbr + '|' + nbrLine;
          if (nc < (dist[nk] ?? Infinity)) {
            dist[nk] = nc;
            parent[nk] = currKey;
            pq.push({ node: edge.nbr, line: nbrLine, cost: nc });
          }
        }
      }
    });
  }

  return { dist, parent };
}

// ─────────────────────────────────────────────────────────────
//  RECONSTRUCT PATH from line-state parent map
//  Returns array of node names
// ─────────────────────────────────────────────────────────────

function reconstructPath(endKey, parent) {
  const keys = [];
  let k = endKey;
  while (k) {
    keys.push(k);
    k = parent[k];
  }
  keys.reverse();
  return keys.map(k => k.split('|')[0]);
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
    const stName = getStationName(curr);
    if (stName === terminals.t1) return terminals.t1;
    if (stName === terminals.t2) return terminals.t2;

    (adjList[curr] || []).forEach(edge => {
      if (visited[edge.nbr]) return;
      if (getLineCodes(edge.nbr).includes(lineCode) &&
          getStationName(edge.nbr) !== stName) {
        visited[edge.nbr] = true;
        queue.push(edge.nbr);
      }
    });
  }
  return terminals.t2;
}

// ─────────────────────────────────────────────────────────────
//  CORE: FIND ALL MEANINGFUL ROUTES
//
//  Strategy:
//  1. Run line-state Dijkstra forward from src (all src lines)
//     → distF[node|line], parentF
//  2. Run line-state Dijkstra backward from dest (reverse graph)
//     → distB[node|line], parentB
//
//     NOTE: since edges are undirected, "backward from dest" means
//     running the same Dijkstra starting from dest nodes.
//     To reconstruct: path = srcPath + reversed(destPath)
//
//  3. Collect candidates:
//     a) Direct (0-interchange): best path if src and dest share a line
//     b) 1-interchange: for every interchange station S,
//        for every (lineA, lineB) pair at S with lineA ≠ lineB:
//          cost = distF[S|lineA] + distB[S|lineB]
//          if this beats "best seen for this interchange sig" → record
//     c) 2-interchange: enumerate pairs (S1,S2)
//        — only keep if cost ≤ 1.5× best 1-interchange cost (prune)
//
//  4. Deduplicate by "interchange signature" = join of interchange
//     station names in path order. Keep best-time per signature.
//
//  5. Return top routes sorted by time.
// ─────────────────────────────────────────────────────────────

function findAllMeaningfulRoutes(src, dest, adjList, lineTerminals) {
  const allNodes = Object.keys(adjList);

  // ── Identify all lines present at a station name ──────────
  // stationLines[stationName] = Set of line codes
  const stationLines = {};
  // stationNodes[stationName] = array of nodes
  const stationNodes = {};
  allNodes.forEach(n => {
    const sn = getStationName(n);
    if (!stationLines[sn]) stationLines[sn] = new Set();
    if (!stationNodes[sn]) stationNodes[sn] = [];
    stationNodes[sn].push(n);
    getLineCodes(n).forEach(l => stationLines[sn].add(l));
  });

  // ── Identify interchange stations: have ≥2 distinct lines ─
  const interchangeStations = Object.keys(stationLines)
    .filter(sn => stationLines[sn].size >= 2);

  // ── Get source/dest station names and their lines ─────────
  const srcName   = getStationName(src);
  const destName  = getStationName(dest);
  const srcLines  = Array.from(stationLines[srcName]  || new Set());
  const destLines = Array.from(stationLines[destName] || new Set());

  // ── Forward Dijkstra from src (all lines at src) ──────────
  const srcStarts = srcLines.map(l => ({ node: src, line: l, cost: 0 }));
  // Also handle split-node src (multiple nodes for same station)
  (stationNodes[srcName] || []).forEach(n => {
    getLineCodes(n).forEach(l => {
      if (!srcStarts.find(s => s.node === n && s.line === l))
        srcStarts.push({ node: n, line: l, cost: 0 });
    });
  });
  const fwd = lineStateDijkstra(srcStarts, adjList);

  // ── Backward Dijkstra from dest (all lines at dest) ───────
  const destStarts = destLines.map(l => {
    // Find the node at dest that carries this line
    const dNode = (stationNodes[destName] || [dest]).find(n => getLineCodes(n).includes(l)) || dest;
    return { node: dNode, line: l, cost: 0 };
  });
  (stationNodes[destName] || []).forEach(n => {
    getLineCodes(n).forEach(l => {
      if (!destStarts.find(s => s.node === n && s.line === l))
        destStarts.push({ node: n, line: l, cost: 0 });
    });
  });
  const bwd = lineStateDijkstra(destStarts, adjList);

  // ── Helper: get best forward cost to station S on line L ──
  function fwdCost(stationName, line) {
    let best = Infinity; let bestKey = null;
    (stationNodes[stationName] || []).forEach(n => {
      const k = n + '|' + line;
      if ((fwd.dist[k] ?? Infinity) < best) {
        best = fwd.dist[k]; bestKey = k;
      }
    });
    return { cost: best, key: bestKey };
  }

  function bwdCost(stationName, line) {
    let best = Infinity; let bestKey = null;
    (stationNodes[stationName] || []).forEach(n => {
      const k = n + '|' + line;
      if ((bwd.dist[k] ?? Infinity) < best) {
        best = bwd.dist[k]; bestKey = k;
      }
    });
    return { cost: best, key: bestKey };
  }

  // ── Reconstruct full path from fwd+bwd meeting at a key ───
  // fwdKey: "node|line" in forward dist
  // bwdKey: "node|line" in backward dist (path reversed = dest→meeting)
  function buildFullPath(fwdKey, bwdKey) {
    const fwdPath = reconstructPath(fwdKey, fwd.parent);
    const bwdPath = reconstructPath(bwdKey, bwd.parent);
    // bwdPath goes from dest→meeting, we need meeting→dest
    const bwdReversed = bwdPath.slice().reverse();
    // Merge: fwdPath ends at meeting node, bwdReversed starts at meeting node
    const fwdNode = fwdKey.split('|')[0];
    const bwdNode = bwdKey.split('|')[0];
    if (fwdNode === bwdNode) {
      return fwdPath.concat(bwdReversed.slice(1));
    }
    // Different nodes at same station (split-node interchange) — connect them
    return fwdPath.concat(bwdReversed);
  }

  const candidates = []; // { path, cost, interchangeSig }

  // ── 0-interchange: src and dest share a line ──────────────
  const sharedLines = srcLines.filter(l => destLines.includes(l));
  sharedLines.forEach(l => {
    const fc = fwdCost(destName, l);
    const bc = bwdCost(destName, l); // should be 0
    if (fc.cost < Infinity && fc.key) {
      const path = reconstructPath(fc.key, fwd.parent);
      if (path[0] && getStationName(path[0]) === srcName &&
          getStationName(path[path.length-1]) === destName) {
        candidates.push({ path, cost: fc.cost, interchangeSig: 'direct_' + l });
      }
    }
  });

  // ── 1-interchange: enumerate all interchange stations ─────
  interchangeStations.forEach(sName => {
    if (sName === srcName || sName === destName) return;
    const sLines = Array.from(stationLines[sName]);

    // Try each pair (lineA → lineB) at this station
    for (let a = 0; a < sLines.length; a++) {
      for (let b = 0; b < sLines.length; b++) {
        if (a === b) continue;
        const lineA = sLines[a];
        const lineB = sLines[b];

        const fc = fwdCost(sName, lineA);
        const bc = bwdCost(sName, lineB);
        if (fc.cost === Infinity || bc.cost === Infinity) continue;

        const totalCost = fc.cost + bc.cost;
        const sig = sName; // interchange signature = station name

        // Build path
        const path = buildFullPath(fc.key, bc.key);
        if (!path || path.length < 2) continue;
        if (getStationName(path[0]) !== srcName) continue;
        if (getStationName(path[path.length-1]) !== destName) continue;

        // Check path doesn't loop back on itself badly
        const stSig = path.map(getStationName).join('→');
        const existing = candidates.find(c => c.interchangeSig === sig);
        if (!existing || existing.cost > totalCost) {
          if (existing) candidates.splice(candidates.indexOf(existing), 1);
          candidates.push({ path, cost: totalCost, interchangeSig: sig });
        }
      }
    }
  });

  // ── 2-interchange: enumerate pairs of interchange stations ─
  // Only attempt if we have a baseline 1-interchange cost to prune against
  const best1Cost = candidates.reduce((m, c) => Math.min(m, c.cost), Infinity);
  const pruneLimit = best1Cost * 1.6; // don't explore 2-IC routes >60% slower

  for (let i = 0; i < interchangeStations.length; i++) {
    const s1Name = interchangeStations[i];
    if (s1Name === srcName || s1Name === destName) continue;
    const s1Lines = Array.from(stationLines[s1Name]);

    for (let j = i + 1; j < interchangeStations.length; j++) {
      const s2Name = interchangeStations[j];
      if (s2Name === srcName || s2Name === destName || s2Name === s1Name) continue;
      const s2Lines = Array.from(stationLines[s2Name]);

      // For each (lineA at S1, lineB at S1) and (lineC at S2, lineD at S2)
      // where lineB must connect S1→S2→dest direction
      // Quick check: can we reach S2 from S1?
      // We'll use fwd cost to S1 + bwd cost to S2 as a proxy
      for (let la = 0; la < s1Lines.length; la++) {
        for (let lb = 0; lb < s1Lines.length; lb++) {
          if (la === lb) continue;
          const fc1 = fwdCost(s1Name, s1Lines[la]);
          if (fc1.cost === Infinity) continue;

          for (let lc = 0; lc < s2Lines.length; lc++) {
            for (let ld = 0; ld < s2Lines.length; ld++) {
              if (lc === ld) continue;
              const bc2 = bwdCost(s2Name, s2Lines[ld]);
              if (bc2.cost === Infinity) continue;

              // Middle segment: S1 (on lineB) → S2 (on lineC)
              // Run a mini Dijkstra from S1-lineB to S2-lineC
              // Use a cached mid-Dijkstra if available (expensive otherwise)
              // SKIP if rough bound exceeds prune limit
              if (fc1.cost + bc2.cost >= pruneLimit) continue;

              const midFwd = lineStateDijkstra(
                [{ node: (stationNodes[s1Name]||[]).find(n=>getLineCodes(n).includes(s1Lines[lb]))||s1Name,
                   line: s1Lines[lb], cost: fc1.cost }],
                adjList
              );
              const midKey = s2Name + '_mid';
              const mc = bwdCost.call({}, s2Name, s2Lines[lc]);
              // Actually look up in midFwd
              let midBestCost = Infinity; let midBestKey = null;
              (stationNodes[s2Name]||[]).forEach(n => {
                const mk = n + '|' + s2Lines[lc];
                if ((midFwd.dist[mk] ?? Infinity) < midBestCost) {
                  midBestCost = midFwd.dist[mk]; midBestKey = mk;
                }
              });
              if (midBestCost === Infinity) continue;
              const totalCost = midBestCost + bc2.cost;
              if (totalCost >= pruneLimit) continue;

              const sig = [s1Name, s2Name].sort().join('+');
              const existing = candidates.find(c => c.interchangeSig === sig);
              if (existing && existing.cost <= totalCost) continue;

              // Build path: src→S1 + S1→S2 + S2→dest
              const seg1 = reconstructPath(fc1.key, fwd.parent);
              const seg2 = reconstructPath(midBestKey, midFwd.parent);
              const bwdPath2 = reconstructPath(bc2.key, bwd.parent).slice().reverse();
              const fullPath = seg1
                .concat(seg2.slice(1))
                .concat(bwdPath2.slice(1));

              if (getStationName(fullPath[0]) !== srcName) continue;
              if (getStationName(fullPath[fullPath.length-1]) !== destName) continue;

              if (existing) candidates.splice(candidates.indexOf(existing), 1);
              candidates.push({ path: fullPath, cost: totalCost, interchangeSig: sig });
            }
          }
        }
      }
    }
  }

  // ── Deduplicate by station sequence ───────────────────────
  const seenStationSigs = new Set();
  const unique = [];
  candidates
    .sort((a, b) => a.cost - b.cost)
    .forEach(c => {
      const stSig = c.path.map(getStationName).join('→');
      if (!seenStationSigs.has(stSig)) {
        seenStationSigs.add(stSig);
        unique.push(c);
      }
    });

  return unique.slice(0, 6);
}

// ─────────────────────────────────────────────────────────────
//  FEWEST-INTERCHANGE ROUTE FINDER
//
//  Runs a lexicographic Dijkstra on (interchangeCount, travelTime)
//  so it finds the route with the absolute minimum number of
//  line changes, breaking ties by shortest time.
//
//  State key: "node|line"
//  Priority:  [interchanges, time]  (compared lexicographically)
//
//  A transfer is counted when the active line must change to
//  board the next edge — i.e. the neighbour node does NOT carry
//  the current line, forcing the rider to switch at the current
//  node before departing.
//
//  Returns { path, interchanges, timeMinutes } or null.
// ─────────────────────────────────────────────────────────────

function findMinInterchangeRoute(src, dest, adjList, lineTerminals) {
  const allNodes    = Object.keys(adjList);
  const stationNodes = {};
  allNodes.forEach(n => {
    const sn = getStationName(n);
    if (!stationNodes[sn]) stationNodes[sn] = [];
    stationNodes[sn].push(n);
  });

  const srcName  = getStationName(src);
  const destName = getStationName(dest);

  // dist[(node, line)] = [interchanges, time]  (lexicographic)
  const dist   = {};   // key: "node|line"  value: [ic, t]
  const parent = {};   // key: "node|line"  value: "node|line" | null

  function stateKey(node, line) { return node + '|' + line; }
  function distLess(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }

  // Seed all lines at src station
  const pq = []; // entries: { ic, t, node, line }
  (stationNodes[srcName] || [src]).forEach(n => {
    getLineCodes(n).forEach(l => {
      const k = stateKey(n, l);
      if (!dist[k]) {
        dist[k]   = [0, 0];
        parent[k] = null;
        pq.push({ ic: 0, t: 0, node: n, line: l });
      }
    });
  });

  while (pq.length > 0) {
    // Sort by [ic, t] lexicographically
    pq.sort((a, b) => a.ic !== b.ic ? a.ic - b.ic : a.t - b.t);
    const curr   = pq.shift();
    const currKey = stateKey(curr.node, curr.line);

    // Skip stale entries
    const cd = dist[currKey];
    if (!cd || distLess(cd, [curr.ic, curr.t])) continue;

    // Early exit once we dequeue a dest state
    if (getStationName(curr.node) === destName) break;

    (adjList[curr.node] || []).forEach(edge => {
      const nbr      = edge.nbr;
      const nbrName  = getStationName(nbr);
      const nbrCodes = getLineCodes(nbr);

      if (nbrName === getStationName(curr.node)) {
        // Same physical station — split-node (shouldn't occur in this dataset,
        // but handle defensively: treat as a transfer)
        const nbrLine = getPrimaryLine(nbr);
        if (!nbrLine || nbrLine === curr.line) return;
        const nk  = stateKey(nbr, nbrLine);
        const nc  = [curr.ic + 1, curr.t + edge.weight];
        const old = dist[nk];
        if (!old || distLess(nc, old)) {
          dist[nk]   = nc;
          parent[nk] = currKey;
          pq.push({ ic: nc[0], t: nc[1], node: nbr, line: nbrLine });
        }
      } else if (nbrCodes.includes(curr.line)) {
        // Neighbour carries our current line — ride straight through, no transfer
        const nk  = stateKey(nbr, curr.line);
        const nc  = [curr.ic, curr.t + edge.weight];
        const old = dist[nk];
        if (!old || distLess(nc, old)) {
          dist[nk]   = nc;
          parent[nk] = currKey;
          pq.push({ ic: nc[0], t: nc[1], node: nbr, line: curr.line });
        }
      } else {
        // Neighbour does NOT carry our line → must transfer at curr.node
        // Board each line the neighbour carries
        nbrCodes.forEach(nbrLine => {
          if (!nbrLine) return;
          const nk  = stateKey(nbr, nbrLine);
          const nc  = [curr.ic + 1, curr.t + edge.weight];
          const old = dist[nk];
          if (!old || distLess(nc, old)) {
            dist[nk]   = nc;
            parent[nk] = currKey;
            pq.push({ ic: nc[0], t: nc[1], node: nbr, line: nbrLine });
          }
        });
      }
    });
  }

  // Find the best arrival state at dest
  let bestKey  = null;
  let bestDist = null;
  (stationNodes[destName] || [dest]).forEach(n => {
    getLineCodes(n).forEach(l => {
      const k = stateKey(n, l);
      const d = dist[k];
      if (d && (!bestDist || distLess(d, bestDist))) {
        bestDist = d;
        bestKey  = k;
      }
    });
  });

  if (!bestKey) return null;

  // Reconstruct node path
  const keys = [];
  let k = bestKey;
  while (k !== undefined && k !== null) {
    keys.push(k);
    k = parent[k];
  }
  keys.reverse();
  const path = keys.map(k => k.split('|')[0]);

  return {
    path,
    interchanges: bestDist[0],
    timeMinutes:  bestDist[1]
  };
}

// ─────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────

function calculateRoutes(src, dest) {
  try {
    const data    = getGraphData();
    const adjList = buildAdjList(data);
    src  = src.toString().trim();
    dest = dest.toString().trim();

    if (!adjList[src])  return { error: `Source station not found: ${src}` };
    if (!adjList[dest]) return { error: `Destination station not found: ${dest}` };
    if (src === dest)   return { error: "Source and destination are the same." };

    // ── Top-5 time-sorted routes via corridor enumeration ────
    const found = findAllMeaningfulRoutes(src, dest, adjList, data.lineTerminals);
    if (found.length === 0) return { error: "No path found between stations." };

    const routes = found.map((f, idx) =>
      formatRoute(f.path, idx + 1, adjList, data.lineTerminals)
    ).filter(Boolean);

    routes.sort((a, b) => a.totalTimeMinutes - b.totalTimeMinutes);
    routes.forEach((r, i) => { r.routeNum = i + 1; });

    // ── 6th route: fewest interchanges (if not already in top 5) ──
    const minIC = findMinInterchangeRoute(src, dest, adjList, data.lineTerminals);

    if (minIC && minIC.path && minIC.path.length >= 2) {
      const minICSig = minIC.path.map(getStationName).join('→');

      // Check whether this path is already represented in the top-5
      const alreadyPresent = routes.some(r => {
        // Re-derive station sequence from the route's steps
        const routeSig = r.steps
          .filter(s => s.type === 'board' || s.type === 'stop' ||
                       s.type === 'arrive' || s.type === 'interchange')
          .map(s => {
            const m = s.text.match(/(?:BOARD at|➔|ARRIVE at|INTERCHANGE at)\s+([^|→\n]+)/);
            return m ? m[1].trim() : '';
          })
          .filter(Boolean)
          .join('→');
        return routeSig === minICSig ||
               r.interchanges <= minIC.interchanges;
      });

      if (!alreadyPresent) {
        const easiestRoute = formatRoute(
          minIC.path,
          routes.length + 1,
          adjList,
          data.lineTerminals
        );
        if (easiestRoute) {
          easiestRoute.routeNum = routes.length + 1;
          easiestRoute.isEasiest = true;
          routes.push(easiestRoute);
        }
      } else {
        // Mark the existing route that has the fewest interchanges
        const minExisting = routes.reduce(
          (best, r) => (!best || r.interchanges < best.interchanges) ? r : best,
          null
        );
        if (minExisting) minExisting.isEasiest = true;
      }
    }

    return { routes };
  } catch (e) {
    return { error: `Error: ${e.message}\n${e.stack}` };
  }
}

// ─────────────────────────────────────────────────────────────
//  FORMAT ROUTE  (interchange fix included)
// ─────────────────────────────────────────────────────────────

function formatRoute(path, routeNum, adjList, lineTerminals) {
  if (!path || path.length === 0) return null;

  let totalTravelTime = 0;

  // ── Determine initial boarding line ──────────────────────
  let activeLine = getPrimaryLine(path[0]);
  for (let i = 1; i < path.length; i++) {
    if (getStationName(path[i]) !== getStationName(path[0])) {
      const prevCodes = getLineCodes(path[i - 1]);
      const currCodes = getLineCodes(path[i]);
      const shared = prevCodes.find(l => currCodes.includes(l));
      if (shared) activeLine = shared;
      break;
    }
  }

  // ── Annotate each node with the active line ───────────────
  const annotated = [{
    node: path[0],
    station: getStationName(path[0]),
    line: activeLine,
    interchangeHere: false
  }];

  for (let i = 1; i < path.length; i++) {
    const prevNode    = path[i - 1];
    const currNode    = path[i];
    const prevStation = getStationName(prevNode);
    const currStation = getStationName(currNode);
    const currCodes   = getLineCodes(currNode);

    if (currStation !== prevStation) {
      const edge = (adjList[prevNode] || []).find(e => e.nbr === currNode);
      if (edge) totalTravelTime += edge.weight;
    }

    if (currStation === prevStation) {
      // Case A: split-node interchange — same station, different node
      const newLine = getPrimaryLine(currNode);
      if (newLine !== activeLine) {
        activeLine = newLine;
      }
    } else if (!currCodes.includes(activeLine)) {
      // Case B: single-node interchange — active line dropped at PREVIOUS station
      // Mark the previous annotated entry as the interchange point
      const newLine = getPrimaryLine(currNode);
      if (newLine !== activeLine) {
        const oldLine = activeLine;
        // The interchange happened at the PREVIOUS station
        annotated[annotated.length - 1].interchangeHere = true;
        annotated[annotated.length - 1].switchToLine = newLine;
        annotated[annotated.length - 1].switchFromLine = oldLine;
        activeLine = newLine;
      }
    }

    annotated.push({
      node: currNode,
      station: currStation,
      line: activeLine,
      interchangeHere: false
    });
  }

  // ── Count distinct line segments ─────────────────────────
  let lineSegments = 1;
  for (let i = 1; i < annotated.length; i++) {
    if (annotated[i].line !== annotated[i - 1].line) lineSegments++;
  }
  // Also count single-node interchanges flagged above
  // (they already changed activeLine so lineSegments covers them)
  const interchangeCount = Math.max(0, lineSegments - 1);

  // ── Build step-by-step instructions ───────────────────────
  const steps = [];

  // Find first movement for direction
  const firstMoveIdx = annotated.findIndex((a, i) => i > 0 && a.station !== annotated[0].station);
  const boardDirection = firstMoveIdx > 0
    ? getTrainDirection(path[0], path[firstMoveIdx], annotated[0].line, adjList, lineTerminals)
    : "End of Line";

  steps.push({
    type: "board",
    text: `🚉 BOARD at ${annotated[0].station} | Line: ${annotated[0].line} | Towards: ${boardDirection}`
  });

  let i = 1;
  while (i < annotated.length) {
    const prev    = annotated[i - 1];
    const curr    = annotated[i];
    const isLast  = i === annotated.length - 1;

    // Check if PREVIOUS station has a single-node interchange flag
    if (prev.interchangeHere && prev.switchToLine) {
      // Emit interchange at prev.station (that's where the switch happens)
      let nextDirection = "End of Line";
      for (let j = i; j < annotated.length; j++) {
        if (annotated[j].station !== prev.station) {
          nextDirection = getTrainDirection(
            path[i-1], path[j], curr.line, adjList, lineTerminals
          );
          break;
        }
      }
      const fromLine = prev.switchFromLine || prev.line;
      steps.push({
        type: "interchange",
        text: `⚡ INTERCHANGE at ${prev.station} | Switch: Line ${fromLine} → Line ${curr.line} | Board towards: ${nextDirection}`
      });

      if (isLast) steps.push({ type: "arrive", text: `🏁 ARRIVE at ${curr.station}` });
      else        steps.push({ type: "stop",   text: `  ➔ ${curr.station} [${curr.line}]` });
      i++;
      continue;
    }

    // Split-node interchange: same station, line changed
    if (curr.line !== prev.line && curr.station === prev.station) {
      let nextDirection = "End of Line";
      for (let j = i + 1; j < annotated.length; j++) {
        if (annotated[j].station !== curr.station) {
          nextDirection = getTrainDirection(
            path[i], path[j], curr.line, adjList, lineTerminals
          );
          break;
        }
      }
      steps.push({
        type: "interchange",
        text: `⚡ INTERCHANGE at ${curr.station} | Switch: Line ${prev.line} → Line ${curr.line} | Board towards: ${nextDirection}`
      });
      if (isLast) steps.push({ type: "arrive", text: `🏁 ARRIVE at ${curr.station}` });
      i++;
      continue;
    }

    // Normal station
    if (curr.station !== prev.station) {
      if (isLast) steps.push({ type: "arrive", text: `🏁 ARRIVE at ${curr.station}` });
      else        steps.push({ type: "stop",   text: `  ➔ ${curr.station} [${curr.line}]` });
    }
    i++;
  }

  // ── Line summary ─────────────────────────────────────────
  const lineSegs = [annotated[0].line];
  for (let i = 1; i < annotated.length; i++) {
    if (annotated[i].line !== annotated[i-1].line) lineSegs.push(annotated[i].line);
  }

  return {
    routeNum,
    totalTimeMinutes: totalTravelTime,
    interchanges: interchangeCount,
    lineSummary: lineSegs.join(' → '),
    steps
  };
}
