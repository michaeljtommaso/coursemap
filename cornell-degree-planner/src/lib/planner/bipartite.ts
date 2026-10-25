/**
 * bipartite.ts — the shared maximum-cardinality matching both requirement
 * engines use (spec 019 D8: "reused from the Engineering engine as a shared
 * pure helper"). Moved verbatim out of majorMatch.ts; behaviour unchanged.
 */

/**
 * Hopcroft–Karp on a bipartite graph (left = courses, right = seats or units). Returns
 * `matchLeft` where matchLeft[u] = the seat index matched to course u, or -1.
 *
 * This is the audit's only-candidate case: a course that is the sole candidate
 * for seat B but also matches seat A must NOT be eaten by A when another course
 * can fill A. Greedy first-fit fails this; HK finds the augmenting path.
 */
export function hopcroftKarp(adj: number[][], nLeft: number, nRight: number): number[] {
  const matchLeft = new Array<number>(nLeft).fill(-1);
  const matchRight = new Array<number>(nRight).fill(-1);
  const dist = new Array<number>(nLeft).fill(0);
  const INF = Number.MAX_SAFE_INTEGER;

  const bfs = (): boolean => {
    const queue: number[] = [];
    for (let u = 0; u < nLeft; u++) {
      if (matchLeft[u] === -1) {
        dist[u] = 0;
        queue.push(u);
      } else {
        dist[u] = INF;
      }
    }
    let found = false;
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      for (const v of adj[u]) {
        const w = matchRight[v];
        if (w === -1) {
          found = true; // reached a free right node → augmenting path exists
        } else if (dist[w] === INF) {
          dist[w] = dist[u] + 1;
          queue.push(w);
        }
      }
    }
    return found;
  };

  const dfs = (u: number): boolean => {
    for (const v of adj[u]) {
      const w = matchRight[v];
      if (w === -1 || (dist[w] === dist[u] + 1 && dfs(w))) {
        matchLeft[u] = v;
        matchRight[v] = u;
        return true;
      }
    }
    dist[u] = INF;
    return false;
  };

  while (bfs()) {
    for (let u = 0; u < nLeft; u++) {
      if (matchLeft[u] === -1) dfs(u);
    }
  }

  return matchLeft;
}
