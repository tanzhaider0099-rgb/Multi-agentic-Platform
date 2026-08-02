const db = require('./db');

function getFullGraph() {
  return db.getGraph();
}

// 1-hop neighborhood around a given entity, for focused views instead of
// dumping the whole project graph every time.
function getNeighborhood(name) {
  const neighbors = db.getEntityNeighbors(name);
  const nodeNames = new Set([name, ...neighbors.map(n => n.neighbor)]);
  const full = db.getGraph();
  const nodes = full.nodes.filter(n => nodeNames.has(n.id));
  const edges = full.edges.filter(e => nodeNames.has(e.source) && nodeNames.has(e.target));
  return { nodes, edges, center: name };
}

module.exports = { getFullGraph, getNeighborhood };
