import type { KnownAnswer } from '../coding-known-answers';
/** Authored faults, each must fail the actual grader. */
export const DSA_ADVANCED_WRONG: readonly KnownAnswer[] = [
  {
    id: 'alg-dsaa-heap-drain',
    label: 'returns immutable results',
    replace: [['return out;', 'return Object.freeze(out);']],
  },
  {
    id: 'alg-dsaa-stable-record-sort',
    label: 'freezes nontrivial sorted results',
    replace: [['return out.concat(left.slice(i),right.slice(j));', 'return Object.freeze(out.concat(left.slice(i),right.slice(j)));']],
  },
  {
    "id": "alg-dsaa-heap-drain",
    "label": "ignores the smaller right child",
    "replace": [
      [
        "if(child+1<work.length&&work[child+1]<work[child])child++;",
        ""
      ]
    ]
  },
  {
    "id": "alg-dsaa-heap-drain",
    "label": "drops repeated output values",
    "replace": [
      [
        "out.push(work[0]);",
        "if(!out.includes(work[0]))out.push(work[0]);"
      ]
    ]
  },
  {
    "id": "alg-dsaa-adjacency",
    "label": "invents reverse edges",
    "replace": [
      [
        "lists[u].push(v);",
        "{lists[u].push(v);lists[v].push(u);}"
      ]
    ]
  },
  {
    "id": "alg-dsaa-adjacency",
    "label": "shares every neighbor list",
    "replace": [
      [
        "Array.from({length:n},()=>[])",
        "Array(n).fill([])"
      ]
    ]
  },
  {
    "id": "alg-dsaa-hop-distances",
    "label": "increases distance by two",
    "replace": [
      [
        "d[v]=d[u]+1;",
        "d[v]=d[u]+2;"
      ]
    ]
  },
  {
    "id": "alg-dsaa-hop-distances",
    "label": "treats every edge as undirected",
    "replace": [
      [
        "g[u].push(v);",
        "{g[u].push(v);g[v].push(u);}"
      ]
    ]
  },
  {
    "id": "alg-dsaa-dag-distances",
    "label": "ignores negative edge signs",
    "replace": [
      [
        "d[u]+w",
        "d[u]+Math.abs(w)"
      ]
    ]
  },
  {
    "id": "alg-dsaa-dag-distances",
    "label": "keeps the largest route",
    "replace": [
      [
        "Math.min(d[v],d[u]+w)",
        "Math.max(d[v],d[u]+w)"
      ]
    ]
  },
  {
    "id": "alg-dsaa-components",
    "label": "counts repeated connections as new merges",
    "replace": [
      [
        "if(a!==b)",
        "if(true)"
      ]
    ]
  },
  {
    "id": "alg-dsaa-components",
    "label": "forgets isolated vertices",
    "replace": [
      [
        "let count=n;",
        "let count=new Set(edges.flat()).size;"
      ]
    ]
  },
  {
    "id": "alg-dsaa-prefix-counts",
    "label": "counts repeated words twice",
    "replace": [
      [
        "for(const word of new Set(words))",
        "for(const word of words)"
      ]
    ]
  },
  {
    "id": "alg-dsaa-prefix-counts",
    "label": "does not count the empty prefix",
    "replace": [
      [
        "node.count++;for(const ch of word)",
        "for(const ch of word)"
      ]
    ]
  },
  {
    "id": "alg-dsaa-combinations",
    "label": "stores the changing path itself",
    "replace": [
      [
        "out.push(path.slice());",
        "out.push(path);"
      ]
    ]
  },
  {
    "id": "alg-dsaa-combinations",
    "label": "omits the final candidate",
    "replace": [
      [
        "x<=n-(k-path.length)+1",
        "x<n-(k-path.length)+1"
      ]
    ]
  },
  {
    "id": "alg-dsaa-meeting-selection",
    "label": "sorts by earliest start",
    "replace": [
      [
        "a[1]-b[1]||a[0]-b[0]",
        "a[0]-b[0]||a[1]-b[1]"
      ]
    ]
  },
  {
    "id": "alg-dsaa-meeting-selection",
    "label": "rejects touching intervals",
    "replace": [
      [
        "interval[0]>=end",
        "interval[0]>end"
      ]
    ]
  },
  {
    "id": "alg-dsaa-interval-intersection",
    "label": "includes an empty touching intersection",
    "replace": [
      [
        "if(start<end)",
        "if(start<=end)"
      ]
    ]
  },
  {
    "id": "alg-dsaa-interval-intersection",
    "label": "takes the wider end",
    "replace": [
      [
        "Math.min(left[i][1],right[j][1])",
        "Math.max(left[i][1],right[j][1])"
      ]
    ]
  },
  {
    "id": "alg-dsaa-distinct-window",
    "label": "shrinks a valid boundary too",
    "replace": [
      [
        "while(counts.size>k)",
        "while(counts.size>=k&&right>=left)"
      ]
    ]
  },
  {
    "id": "alg-dsaa-distinct-window",
    "label": "drops a still-present value",
    "replace": [
      [
        "else counts.set(old,count);",
        "else counts.delete(old);"
      ]
    ]
  },
  {
    "id": "alg-dsaa-grid-paths",
    "label": "lets routes leak across an obstacle",
    "replace": [
      [
        "if(grid[r][c]===1)ways[c]=0;",
        "if(grid[r][c]===1)continue;"
      ]
    ]
  },
  {
    "id": "alg-dsaa-grid-paths",
    "label": "drops the starting path",
    "replace": [
      [
        "ways[0]=1;",
        "ways[0]=0;"
      ]
    ]
  },
  {
    "id": "alg-dsaa-popcount32",
    "label": "stops after a signed high-bit result",
    "replace": [
      [
        "while(word!==0)",
        "while((word|0)>0)"
      ]
    ]
  },
  {
    "id": "alg-dsaa-popcount32",
    "label": "counts only the low31 bits",
    "replace": [
      [
        "let word=value>>>0",
        "let word=value&2147483647"
      ]
    ]
  },
  {
    "id": "alg-dsaa-stable-record-sort",
    "label": "takes right-side equal records first",
    "replace": [
      [
        "left[i].key<=right[j].key",
        "left[i].key<right[j].key"
      ]
    ]
  },
  {
    "id": "alg-dsaa-stable-record-sort",
    "label": "returns the caller array at a leaf",
    "replace": [
      [
        "if(records.length<2)return records.slice();",
        "if(records.length<2)return records;"
      ]
    ]
  },
  {
    "id": "alg-dsaa-weighted-schedule",
    "label": "rejects an equal-time predecessor",
    "replace": [
      [
        "jobs[mid][1]<=jobs[i][0]",
        "jobs[mid][1]<jobs[i][0]"
      ]
    ]
  },
  {
    "id": "alg-dsaa-weighted-schedule",
    "label": "optimizes meeting count instead of reward",
    "replace": [
      [
        "best[lo]+jobs[i][2]",
        "best[lo]+1"
      ]
    ]
  },
  {
    "id": "alg-dsaa-nonadjacent-sum",
    "label": "allows adjacent rewards",
    "replace": [
      [
        "const nextTake=skip+value;",
        "const nextTake=Math.max(skip,take)+value;"
      ]
    ]
  },
  {
    "id": "alg-dsaa-nonadjacent-sum",
    "label": "requires the last position",
    "replace": [
      [
        "return Math.max(skip,take);",
        "return take;"
      ]
    ]
  }
];
