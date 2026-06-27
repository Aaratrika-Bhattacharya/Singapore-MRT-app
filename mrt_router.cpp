// ============================================================
//  Singapore MRT Router — C++17
//  Data loaded from CSV files:
//    stations.csv  →  one node per line, e.g.  "Bugis~EW/DT"
//    edges.csv     →  NodeA,NodeB,minutes      e.g.  "Bugis~EW,City Hall~EW,3"
//    lines.csv     →  LineCode,Terminal1,Terminal2
//
//  Usage:
//    ./mrt_router
//    Then follow prompts: enter source node, dest node
//    (node = full name as in stations.csv, e.g. "Bugis~EW/DT")
// ============================================================

#include <bits/stdc++.h>
using namespace std;

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────

struct Edge { string nbr; int weight; };
using AdjList = unordered_map<string, vector<Edge>>;

struct LineTerminal { string t1, t2; };
using LineTerminals = unordered_map<string, LineTerminal>;

// State for line-aware Dijkstra
struct State {
    string node, line;
    int cost;
    bool operator>(const State& o) const { return cost > o.cost; }
};

// Route result
struct Step {
    string type; // "board" | "interchange" | "stop" | "arrive"
    string text;
};
struct Route {
    int routeNum, totalTimeMinutes, interchanges;
    string lineSummary;
    vector<Step> steps;
};

// ─────────────────────────────────────────────────────────────
//  STRING UTILITIES
// ─────────────────────────────────────────────────────────────

string trim(const string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    size_t b = s.find_last_not_of(" \t\r\n");
    return (a == string::npos) ? "" : s.substr(a, b - a + 1);
}

vector<string> split(const string& s, char delim) {
    vector<string> res;
    stringstream ss(s);
    string tok;
    while (getline(ss, tok, delim)) res.push_back(trim(tok));
    return res;
}

string stationName(const string& node) {
    auto p = node.find('~');
    return (p == string::npos) ? node : trim(node.substr(0, p));
}

vector<string> lineCodes(const string& node) {
    auto p = node.find('~');
    if (p == string::npos || p + 1 >= node.size()) return {};
    return split(node.substr(p + 1), '/');
}

string primaryLine(const string& node) {
    auto c = lineCodes(node);
    return c.empty() ? "" : c[0];
}

bool hasLine(const string& node, const string& line) {
    for (auto& l : lineCodes(node)) if (l == line) return true;
    return false;
}

// ─────────────────────────────────────────────────────────────
//  DATA LOADING
// ─────────────────────────────────────────────────────────────

struct GraphData {
    vector<string>  stations;
    AdjList         adj;
    LineTerminals   lineTerminals;
    // station-name → set of lines, list of nodes
    unordered_map<string, set<string>>    stationLines;
    unordered_map<string, vector<string>> stationNodes;
};

GraphData loadData(const string& stationsFile,
                   const string& edgesFile,
                   const string& linesFile)
{
    GraphData g;

    // ── Stations ─────────────────────────────────────────────
    {
        ifstream f(stationsFile);
        if (!f) throw runtime_error("Cannot open " + stationsFile);
        string line;
        getline(f, line); // skip header
        while (getline(f, line)) {
            string node = trim(line);
            if (node.empty()) continue;
            g.stations.push_back(node);
            g.adj[node]; // ensure key exists
            string sn = stationName(node);
            g.stationNodes[sn].push_back(node);
            for (auto& lc : lineCodes(node)) g.stationLines[sn].insert(lc);
        }
    }

    // ── Edges ────────────────────────────────────────────────
    {
        ifstream f(edgesFile);
        if (!f) throw runtime_error("Cannot open " + edgesFile);
        string line;
        getline(f, line); // skip header
        while (getline(f, line)) {
            auto parts = split(line, ',');
            if (parts.size() < 3) continue;
            string u = parts[0], v = parts[1];
            int w = stoi(parts[2]);
            if (g.adj.count(u) && g.adj.count(v)) {
                g.adj[u].push_back({v, w});
                g.adj[v].push_back({u, w});
            }
        }
    }

    // ── Lines ────────────────────────────────────────────────
    {
        ifstream f(linesFile);
        if (!f) throw runtime_error("Cannot open " + linesFile);
        string line;
        getline(f, line); // skip header
        while (getline(f, line)) {
            auto parts = split(line, ',');
            if (parts.size() < 3) continue;
            g.lineTerminals[parts[0]] = {parts[1], parts[2]};
        }
    }

    return g;
}

// ─────────────────────────────────────────────────────────────
//  LINE-STATE DIJKSTRA
//  State key = "node|line"
// ─────────────────────────────────────────────────────────────

struct DijkstraResult {
    unordered_map<string,int>    dist;
    unordered_map<string,string> parent; // state → parent state
};

DijkstraResult lineStateDijkstra(const vector<State>& starts,
                                  const AdjList& adj)
{
    DijkstraResult res;
    priority_queue<State, vector<State>, greater<State>> pq;

    for (auto& s : starts) {
        string k = s.node + "|" + s.line;
        if (!res.dist.count(k) || res.dist[k] > s.cost) {
            res.dist[k] = s.cost;
            pq.push(s);
        }
    }

    while (!pq.empty()) {
        auto [cNode, cLine, cCost] = pq.top(); pq.pop();
        string cKey = cNode + "|" + cLine;
        if (res.dist.count(cKey) && res.dist[cKey] < cCost) continue;

        auto it = adj.find(cNode);
        if (it == adj.end()) continue;

        for (auto& edge : it->second) {
            string nbrSt  = stationName(edge.nbr);
            string currSt = stationName(cNode);

            if (nbrSt == currSt) {
                // Same station, different node → split-node interchange
                string nbrLine = primaryLine(edge.nbr);
                if (nbrLine.empty() || nbrLine == cLine) continue;
                int nc = cCost + edge.weight;
                string nk = edge.nbr + "|" + nbrLine;
                if (!res.dist.count(nk) || res.dist[nk] > nc) {
                    res.dist[nk] = nc;
                    res.parent[nk] = cKey;
                    pq.push({edge.nbr, nbrLine, nc});
                }
            } else {
                if (hasLine(edge.nbr, cLine)) {
                    // Same line, move forward
                    int nc = cCost + edge.weight;
                    string nk = edge.nbr + "|" + cLine;
                    if (!res.dist.count(nk) || res.dist[nk] > nc) {
                        res.dist[nk] = nc;
                        res.parent[nk] = cKey;
                        pq.push({edge.nbr, cLine, nc});
                    }
                } else {
                    // Single-node interchange: active line not on neighbour
                    string nbrLine = primaryLine(edge.nbr);
                    if (nbrLine.empty()) continue;
                    int nc = cCost + edge.weight;
                    string nk = edge.nbr + "|" + nbrLine;
                    if (!res.dist.count(nk) || res.dist[nk] > nc) {
                        res.dist[nk] = nc;
                        res.parent[nk] = cKey;
                        pq.push({edge.nbr, nbrLine, nc});
                    }
                }
            }
        }
    }
    return res;
}

// ─────────────────────────────────────────────────────────────
//  RECONSTRUCT PATH  (node names only)
// ─────────────────────────────────────────────────────────────

vector<string> reconstructPath(const string& endKey,
                                const unordered_map<string,string>& parent)
{
    vector<string> keys;
    string k = endKey;
    while (!k.empty()) {
        keys.push_back(k);
        auto it = parent.find(k);
        k = (it != parent.end()) ? it->second : "";
    }
    reverse(keys.begin(), keys.end());
    vector<string> path;
    for (auto& key : keys) path.push_back(split(key,'|')[0]);
    return path;
}

// ─────────────────────────────────────────────────────────────
//  TRAIN DIRECTION FINDER (BFS along a single line)
// ─────────────────────────────────────────────────────────────

string getTrainDirection(const string& curNode, const string& nextNode,
                          const string& lineCode,
                          const AdjList& adj,
                          const LineTerminals& lt)
{
    auto ltIt = lt.find(lineCode);
    if (ltIt == lt.end()) return "Unknown";
    const auto& [t1, t2] = ltIt->second;

    unordered_set<string> visited;
    queue<string> q;
    visited.insert(curNode);
    visited.insert(nextNode);
    q.push(nextNode);

    while (!q.empty()) {
        string curr = q.front(); q.pop();
        string sn = stationName(curr);
        if (sn == t1) return t1;
        if (sn == t2) return t2;

        auto it = adj.find(curr);
        if (it == adj.end()) continue;
        for (auto& e : it->second) {
            if (visited.count(e.nbr)) continue;
            if (hasLine(e.nbr, lineCode) && stationName(e.nbr) != sn) {
                visited.insert(e.nbr);
                q.push(e.nbr);
            }
        }
    }
    return t2;
}

// ─────────────────────────────────────────────────────────────
//  HELPERS for cost/key lookup
// ─────────────────────────────────────────────────────────────

pair<int,string> bestCost(const string& sName, const string& line,
                           const unordered_map<string,vector<string>>& stationNodes,
                           const DijkstraResult& dr)
{
    int best = INT_MAX; string bestKey;
    auto it = stationNodes.find(sName);
    if (it == stationNodes.end()) return {INT_MAX, ""};
    for (auto& n : it->second) {
        string k = n + "|" + line;
        auto d = dr.dist.find(k);
        if (d != dr.dist.end() && d->second < best) {
            best = d->second; bestKey = k;
        }
    }
    return {best, bestKey};
}

vector<string> buildFullPath(const string& fwdKey, const string& bwdKey,
                              const DijkstraResult& fwd, const DijkstraResult& bwd)
{
    auto fwdPath = reconstructPath(fwdKey, fwd.parent);
    auto bwdPath = reconstructPath(bwdKey, bwd.parent);
    reverse(bwdPath.begin(), bwdPath.end()); // now goes meeting→dest

    string fwdNode = split(fwdKey,'|')[0];
    string bwdNode = split(bwdKey,'|')[0];

    if (fwdNode == bwdNode) {
        // Same node: concatenate, skip duplicate
        fwdPath.insert(fwdPath.end(), bwdPath.begin()+1, bwdPath.end());
    } else {
        // Different nodes at same station (split-node interchange)
        fwdPath.insert(fwdPath.end(), bwdPath.begin(), bwdPath.end());
    }
    return fwdPath;
}

// ─────────────────────────────────────────────────────────────
//  FORMAT ROUTE
// ─────────────────────────────────────────────────────────────

struct AnnotatedNode {
    string node, station, line;
    bool   interchangeHere = false;
    string switchFromLine, switchToLine;
};

Route formatRoute(const vector<string>& path, int routeNum,
                  const AdjList& adj, const LineTerminals& lt)
{
    if (path.empty()) return {};

    // ── Determine initial boarding line ───────────────────────
    string activeLine = primaryLine(path[0]);
    for (size_t i = 1; i < path.size(); i++) {
        if (stationName(path[i]) != stationName(path[0])) {
            auto pc = lineCodes(path[i-1]);
            auto cc = lineCodes(path[i]);
            for (auto& l : pc)
                if (find(cc.begin(),cc.end(),l) != cc.end()) { activeLine = l; break; }
            break;
        }
    }

    // ── Annotate ──────────────────────────────────────────────
    vector<AnnotatedNode> ann;
    ann.push_back({path[0], stationName(path[0]), activeLine});
    int totalTime = 0;

    for (size_t i = 1; i < path.size(); i++) {
        string prevNode = path[i-1], currNode = path[i];
        string prevSt = stationName(prevNode), currSt = stationName(currNode);
        auto cc = lineCodes(currNode);

        if (currSt != prevSt) {
            auto adjIt = adj.find(prevNode);
            if (adjIt != adj.end())
                for (auto& e : adjIt->second)
                    if (e.nbr == currNode) { totalTime += e.weight; break; }
        }

        if (currSt == prevSt) {
            // Case A: split-node interchange
            string nl = primaryLine(currNode);
            if (nl != activeLine) activeLine = nl;
        } else if (!hasLine(currNode, activeLine)) {
            // Case B: single-node interchange at PREVIOUS station
            string nl = primaryLine(currNode);
            if (nl != activeLine) {
                ann.back().interchangeHere = true;
                ann.back().switchFromLine  = activeLine;
                ann.back().switchToLine    = nl;
                activeLine = nl;
            }
        }
        ann.push_back({currNode, currSt, activeLine});
    }

    // ── Count interchanges ────────────────────────────────────
    int lineSegs = 1;
    for (size_t i = 1; i < ann.size(); i++)
        if (ann[i].line != ann[i-1].line) lineSegs++;
    int interchanges = max(0, lineSegs - 1);

    // ── Build steps ───────────────────────────────────────────
    vector<Step> steps;
    size_t firstMove = 0;
    for (size_t i = 1; i < ann.size(); i++)
        if (ann[i].station != ann[0].station) { firstMove = i; break; }

    string boardDir = (firstMove > 0)
        ? getTrainDirection(path[0], path[firstMove], ann[0].line, adj, lt)
        : "End of Line";

    steps.push_back({"board",
        "BOARD at " + ann[0].station + " | Line: " + ann[0].line + " | Towards: " + boardDir});

    size_t i = 1;
    while (i < ann.size()) {
        auto& prev = ann[i-1];
        auto& curr = ann[i];
        bool isLast = (i == ann.size()-1);

        // Single-node interchange flag on previous node
        if (prev.interchangeHere && !prev.switchToLine.empty()) {
            string nextDir = "End of Line";
            for (size_t j = i; j < ann.size(); j++) {
                if (ann[j].station != prev.station) {
                    nextDir = getTrainDirection(path[i-1], path[j], curr.line, adj, lt);
                    break;
                }
            }
            steps.push_back({"interchange",
                "INTERCHANGE at " + prev.station
                + " | Switch: Line " + prev.switchFromLine
                + " -> Line " + curr.line
                + " | Board towards: " + nextDir});

            if (isLast) steps.push_back({"arrive", "ARRIVE at " + curr.station});
            else        steps.push_back({"stop",   "  -> " + curr.station + " [" + curr.line + "]"});
            i++; continue;
        }

        // Split-node interchange
        if (curr.line != prev.line && curr.station == prev.station) {
            string nextDir = "End of Line";
            for (size_t j = i+1; j < ann.size(); j++) {
                if (ann[j].station != curr.station) {
                    nextDir = getTrainDirection(path[i], path[j], curr.line, adj, lt);
                    break;
                }
            }
            steps.push_back({"interchange",
                "INTERCHANGE at " + curr.station
                + " | Switch: Line " + prev.line
                + " -> Line " + curr.line
                + " | Board towards: " + nextDir});

            if (isLast) steps.push_back({"arrive", "ARRIVE at " + curr.station});
            i++; continue;
        }

        // Normal station
        if (curr.station != prev.station) {
            if (isLast) steps.push_back({"arrive", "ARRIVE at " + curr.station});
            else        steps.push_back({"stop",   "  -> " + curr.station + " [" + curr.line + "]"});
        }
        i++;
    }

    // ── Line summary ──────────────────────────────────────────
    string lineSummary = ann[0].line;
    for (size_t i = 1; i < ann.size(); i++)
        if (ann[i].line != ann[i-1].line) lineSummary += " -> " + ann[i].line;

    return {routeNum, totalTime, interchanges, lineSummary, steps};
}

// ─────────────────────────────────────────────────────────────
//  FIND ALL MEANINGFUL ROUTES
// ─────────────────────────────────────────────────────────────

struct Candidate {
    vector<string> path;
    int cost;
    string interchangeSig;
};

vector<Route> findAllRoutes(const string& src, const string& dest,
                             const GraphData& g)
{
    string srcName = stationName(src), destName = stationName(dest);

    auto getLines = [&](const string& sn) -> vector<string> {
        vector<string> v;
        auto it = g.stationLines.find(sn);
        if (it != g.stationLines.end()) for (auto& l : it->second) v.push_back(l);
        return v;
    };
    auto getNodes = [&](const string& sn) -> vector<string> {
        auto it = g.stationNodes.find(sn);
        return (it != g.stationNodes.end()) ? it->second : vector<string>{};
    };

    // ── Forward Dijkstra from src ─────────────────────────────
    vector<State> srcStarts;
    for (auto& n : getNodes(srcName))
        for (auto& l : lineCodes(n))
            srcStarts.push_back({n, l, 0});
    auto fwd = lineStateDijkstra(srcStarts, g.adj);

    // ── Backward Dijkstra from dest ───────────────────────────
    vector<State> destStarts;
    for (auto& n : getNodes(destName))
        for (auto& l : lineCodes(n))
            destStarts.push_back({n, l, 0});
    auto bwd = lineStateDijkstra(destStarts, g.adj);

    auto fwdCost = [&](const string& sn, const string& line) {
        return bestCost(sn, line, g.stationNodes, fwd);
    };
    auto bwdCost = [&](const string& sn, const string& line) {
        return bestCost(sn, line, g.stationNodes, bwd);
    };

    vector<Candidate> candidates;

    // ── 0-interchange ─────────────────────────────────────────
    auto srcLines = getLines(srcName), destLines = getLines(destName);
    for (auto& l : srcLines) {
        if (find(destLines.begin(), destLines.end(), l) == destLines.end()) continue;
        auto [cost, key] = fwdCost(destName, l);
        if (cost == INT_MAX || key.empty()) continue;
        auto path = reconstructPath(key, fwd.parent);
        if (stationName(path.front()) != srcName) continue;
        if (stationName(path.back())  != destName) continue;
        candidates.push_back({path, cost, "direct_" + l});
    }

    // ── 1-interchange ─────────────────────────────────────────
    for (auto& [sName, sLines] : g.stationLines) {
        if (sName == srcName || sName == destName) continue;
        if (sLines.size() < 2) continue;
        vector<string> sl(sLines.begin(), sLines.end());
        for (size_t a = 0; a < sl.size(); a++) {
            for (size_t b = 0; b < sl.size(); b++) {
                if (a == b) continue;
                auto [fc, fk] = fwdCost(sName, sl[a]);
                auto [bc, bk] = bwdCost(sName, sl[b]);
                if (fc == INT_MAX || bc == INT_MAX) continue;
                int total = fc + bc;
                auto path = buildFullPath(fk, bk, fwd, bwd);
                if (path.size() < 2) continue;
                if (stationName(path.front()) != srcName) continue;
                if (stationName(path.back())  != destName) continue;
                auto sig = sName;
                auto ex = find_if(candidates.begin(), candidates.end(),
                    [&](auto& c){ return c.interchangeSig == sig; });
                if (ex == candidates.end())
                    candidates.push_back({path, total, sig});
                else if (ex->cost > total)
                    *ex = {path, total, sig};
            }
        }
    }

    // ── 2-interchange (pruned) ────────────────────────────────
    int best1 = INT_MAX;
    for (auto& c : candidates) best1 = min(best1, c.cost);
    int pruneLimit = (best1 == INT_MAX) ? INT_MAX : (int)(best1 * 1.6);

    vector<string> ixStations;
    for (auto& [sn, sl] : g.stationLines)
        if ((int)sl.size() >= 2 && sn != srcName && sn != destName)
            ixStations.push_back(sn);

    for (size_t si = 0; si < ixStations.size(); si++) {
        auto& s1 = ixStations[si];
        vector<string> s1l(g.stationLines.at(s1).begin(), g.stationLines.at(s1).end());
        for (size_t sj = si+1; sj < ixStations.size(); sj++) {
            auto& s2 = ixStations[sj];
            vector<string> s2l(g.stationLines.at(s2).begin(), g.stationLines.at(s2).end());

            for (auto& la : s1l) {
                auto [fc1, fk1] = fwdCost(s1, la);
                if (fc1 == INT_MAX) continue;
                for (auto& lb : s1l) {
                    if (lb == la) continue;
                    // find node at s1 with line lb
                    string s1node;
                    for (auto& n : getNodes(s1))
                        if (hasLine(n, lb)) { s1node = n; break; }
                    if (s1node.empty()) continue;

                    for (auto& lc : s2l) {
                        for (auto& ld : s2l) {
                            if (lc == ld) continue;
                            auto [bc2, bk2] = bwdCost(s2, ld);
                            if (bc2 == INT_MAX) continue;
                            if (fc1 + bc2 >= pruneLimit) continue;

                            // Mid segment: s1 on lb → s2 on lc
                            auto midRes = lineStateDijkstra({{s1node, lb, fc1}}, g.adj);
                            auto [mc, mk] = bestCost(s2, lc, g.stationNodes, midRes);
                            if (mc == INT_MAX) continue;
                            int total = mc + bc2;
                            if (total >= pruneLimit) continue;

                            auto seg1 = reconstructPath(fk1, fwd.parent);
                            auto seg2 = reconstructPath(mk, midRes.parent);
                            auto seg3 = reconstructPath(bk2, bwd.parent);
                            reverse(seg3.begin(), seg3.end());

                            vector<string> fullPath = seg1;
                            for (size_t k = 1; k < seg2.size(); k++) fullPath.push_back(seg2[k]);
                            for (size_t k = 1; k < seg3.size(); k++) fullPath.push_back(seg3[k]);

                            if (stationName(fullPath.front()) != srcName) continue;
                            if (stationName(fullPath.back())  != destName) continue;

                            string sig = (s1 < s2) ? s1+"+"+s2 : s2+"+"+s1;
                            auto ex = find_if(candidates.begin(), candidates.end(),
                                [&](auto& c){ return c.interchangeSig == sig; });
                            if (ex == candidates.end())
                                candidates.push_back({fullPath, total, sig});
                            else if (ex->cost > total)
                                *ex = {fullPath, total, sig};
                        }
                    }
                }
            }
        }
    }

    // ── Deduplicate by station sequence ───────────────────────
    sort(candidates.begin(), candidates.end(),
         [](auto& a, auto& b){ return a.cost < b.cost; });

    set<string> seen;
    vector<Candidate> unique;
    for (auto& c : candidates) {
        string sig;
        for (auto& n : c.path) sig += stationName(n) + ">";
        if (!seen.count(sig)) { seen.insert(sig); unique.push_back(c); }
        if (unique.size() >= 6) break;
    }

    // ── Format ────────────────────────────────────────────────
    vector<Route> routes;
    for (int i = 0; i < (int)unique.size(); i++)
        routes.push_back(formatRoute(unique[i].path, i+1, g.adj, g.lineTerminals));

    sort(routes.begin(), routes.end(),
         [](auto& a, auto& b){ return a.totalTimeMinutes < b.totalTimeMinutes; });
    for (int i = 0; i < (int)routes.size(); i++) routes[i].routeNum = i+1;

    return routes;
}

// ─────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────

int main(int argc, char** argv) {
    ios_base::sync_with_stdio(false);
    cin.tie(nullptr);

    // File paths (override via command-line args if needed)
    string stationsFile = "stations.csv";
    string edgesFile    = "edges.csv";
    string linesFile    = "lines.csv";
    if (argc >= 4) { stationsFile = argv[1]; edgesFile = argv[2]; linesFile = argv[3]; }

    GraphData g;
    try {
        g = loadData(stationsFile, edgesFile, linesFile);
    } catch (exception& e) {
        cerr << "Error loading data: " << e.what() << "\n";
        return 1;
    }

    cout << "Loaded " << g.stations.size() << " station nodes.\n\n";

    while (true) {
        string src, dest;
        cout << "Source station node (or 'quit'): ";
        getline(cin, src); src = trim(src);
        if (src == "quit") break;

        cout << "Destination station node: ";
        getline(cin, dest); dest = trim(dest);

        if (!g.adj.count(src))  { cout << "Source not found.\n\n"; continue; }
        if (!g.adj.count(dest)) { cout << "Destination not found.\n\n"; continue; }
        if (src == dest)        { cout << "Same station.\n\n"; continue; }

        auto routes = findAllRoutes(src, dest, g);
        if (routes.empty()) { cout << "No routes found.\n\n"; continue; }

        cout << "\n══════════════════════════════════════════\n";
        cout << "  Found " << routes.size() << " route(s)\n";
        cout << "══════════════════════════════════════════\n\n";

        for (auto& r : routes) {
            cout << "Route " << r.routeNum
                 << "  |  " << r.totalTimeMinutes << " min"
                 << "  |  " << r.interchanges << " interchange(s)"
                 << "  |  " << r.lineSummary << "\n";
            cout << "──────────────────────────────────────────\n";
            for (auto& s : r.steps) cout << "  " << s.text << "\n";
            cout << "\n";
        }
    }

    return 0;
}
