/** Original Advanced Learn exercises; bodies only, no sealed answers. */
import type { CodingTaskSource } from '../types';
export const DSA_ADVANCED_TASKS: CodingTaskSource[] = [
  {
    "id": "alg-dsaa-heap-drain",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 1,
    "tier": 3,
    "focus": [
      "for",
      "while"
    ],
    "title": "Drain a min-heap",
    "prompt": "Return all values in the valid binary min-heap `heap` in ascending numeric order, preserving duplicates. The heap is a dense array of at most 128 finite integers in [-1000000,1000000], satisfying parent <= child with zero-based children 2i+1 and 2i+2. Empty input returns []. Return a fresh mutable array and leave the possibly frozen input unchanged. A reference solution repeatedly removes the root and repairs a private heap; equivalent correct algorithms are accepted. Target: O(n log n) time and O(n) extra space, where n is heap.length.",
    "starter": "const drainHeap = (heap) => {\n\n};\n",
    "skeleton": "const drainHeap = (heap) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "After removing the root, move the last element to index0 and compare both children before exchanging.",
      "The output keeps repeated priorities. Work on a copy so the caller still owns the original heap."
    ],
    "approach": [
      "After removing the root, move the last element to index0 and compare both children before exchanging.",
      "The output keeps repeated priorities. Work on a copy so the caller still owns the original heap.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "drainHeap([1,4,2,9,5,3])",
        "expected": [
          1,
          2,
          3,
          4,
          5,
          9
        ]
      },
      {
        "call": "drainHeap([])",
        "expected": [],
        "edge": true
      },
      {
        "call": "drainHeap([7])",
        "expected": [
          7
        ]
      },
      {
        "call": "drainHeap([1,1,2,2])",
        "expected": [
          1,
          1,
          2,
          2
        ]
      },
      {
        "call": "drainHeap(Object.freeze([-3,-1,0,4]))",
        "expected": [
          -3,
          -1,
          0,
          4
        ],
        "edge": true
      }
    ]
  },
  {
    "id": "alg-dsaa-adjacency",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 2,
    "tier": 3,
    "focus": [
      "for",
      "while"
    ],
    "title": "Build a directed adjacency list",
    "prompt": "Return an array of n neighbor arrays for the directed graph edges. Vertices are integers 0..n-1. Preserve edge input order inside each source list, including duplicates and self-loops; never invent reverse edges. Include empty lists for isolated vertices. n is 0..100 and edges has at most 500 valid pairs. Leave the possibly frozen edge array and pairs unchanged; return fresh neighbor arrays with no sharing. Target: O(n+m) time and O(n+m) output space, where m is edges.length.",
    "starter": "const adjacency = (n, edges) => {\n\n};\n",
    "skeleton": "const adjacency = (n, edges) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Allocate one distinct list per vertex, including vertices with no outgoing edges.",
      "Each directed edge contributes only to its source list; preserve the supplied order and multiplicity."
    ],
    "approach": [
      "Allocate one distinct list per vertex, including vertices with no outgoing edges.",
      "Each directed edge contributes only to its source list; preserve the supplied order and multiplicity.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "adjacency(3,[[0,2],[0,1],[2,2]])",
        "expected": [
          [
            2,
            1
          ],
          [],
          [
            2
          ]
        ]
      },
      {
        "call": "adjacency(0,[])",
        "expected": [],
        "edge": true
      },
      {
        "call": "adjacency(3,[])",
        "expected": [
          [],
          [],
          []
        ]
      },
      {
        "call": "adjacency(2,[[0,1],[0,1]])",
        "expected": [
          [
            1,
            1
          ],
          []
        ]
      },
      {
        "call": "adjacency(1,[[0,0]])",
        "expected": [
          [
            0
          ]
        ]
      }
    ]
  },
  {
    "id": "alg-dsaa-hop-distances",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 3,
    "tier": 3,
    "focus": [
      "for",
      "while"
    ],
    "title": "Find unweighted hop distances",
    "prompt": "Return an array of shortest hop counts from source in a directed unweighted graph. Unreachable vertices have -1 and source has 0. n is 1..100, source is valid, and edges has at most 500 valid vertex pairs; duplicates, cycles and self-loops are allowed. Leave inputs unchanged, including frozen edge pairs. Target: O(n+m) time and O(n+m) extra space with FIFO breadth-first search, where m is edges.length. Equivalent correct results are accepted.",
    "starter": "const hopDistances = (n, edges, source) => {\n\n};\n",
    "skeleton": "const hopDistances = (n, edges, source) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Mark a vertex when it enters the FIFO queue, recording one more hop than its predecessor.",
      "Use -1 to distinguish undiscovered vertices, and do not add reverse edges."
    ],
    "approach": [
      "Mark a vertex when it enters the FIFO queue, recording one more hop than its predecessor.",
      "Use -1 to distinguish undiscovered vertices, and do not add reverse edges.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "hopDistances(4,[[0,1],[1,2],[0,2]],0)",
        "expected": [
          0,
          1,
          1,
          -1
        ]
      },
      {
        "call": "hopDistances(1,[],0)",
        "expected": [
          0
        ],
        "edge": true
      },
      {
        "call": "hopDistances(3,[[0,1]],2)",
        "expected": [
          -1,
          -1,
          0
        ]
      },
      {
        "call": "hopDistances(3,[[0,1],[1,0],[1,2]],0)",
        "expected": [
          0,
          1,
          2
        ]
      },
      {
        "call": "hopDistances(2,[[1,0]],0)",
        "expected": [
          0,
          -1
        ]
      }
    ]
  },
  {
    "id": "alg-dsaa-dag-distances",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 4,
    "tier": 3,
    "focus": [
      "for",
      "while"
    ],
    "title": "Relax weighted paths in a DAG",
    "prompt": "Return shortest distances from source in a directed acyclic graph. Each edge is [from,to,weight], where vertices are 0..n-1 and weights are integers in [-100,100]. Use null for unreachable vertices and 0 for the source. n is 1..50 and at most 200 edges are valid; input is guaranteed acyclic but vertex ids need not be topologically ordered. Parallel edges are allowed. Preserve all inputs, including frozen pairs. Target: O(n+m) time and O(n+m) extra space using a topological order, where m is edges.length. Negative weights are valid because the graph has no cycles.",
    "starter": "const dagDistances = (n, edges, source) => {\n\n};\n",
    "skeleton": "const dagDistances = (n, edges, source) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Compute an order in which every predecessor appears before its outgoing target, including disconnected vertices.",
      "Relax from current distances in that order; Infinity plus a finite weight stays unreachable."
    ],
    "approach": [
      "Compute an order in which every predecessor appears before its outgoing target, including disconnected vertices.",
      "Relax from current distances in that order; Infinity plus a finite weight stays unreachable.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 35,
    "tests": [
      {
        "call": "dagDistances(3,[[0,1,5],[0,2,10],[1,2,-3]],0)",
        "expected": [
          0,
          5,
          2
        ]
      },
      {
        "call": "dagDistances(1,[],0)",
        "expected": [
          0
        ],
        "edge": true
      },
      {
        "call": "dagDistances(3,[],1)",
        "expected": [
          null,
          0,
          null
        ]
      },
      {
        "call": "dagDistances(3,[[2,1,2],[1,0,3]],2)",
        "expected": [
          5,
          2,
          0
        ]
      },
      {
        "call": "dagDistances(2,[[0,1,9],[0,1,2]],0)",
        "expected": [
          0,
          2
        ]
      }
    ]
  },
  {
    "id": "alg-dsaa-components",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 5,
    "tier": 3,
    "focus": [
      "for",
      "while",
      "map-set"
    ],
    "title": "Count undirected components",
    "prompt": "Return the number of connected components in an undirected graph with n vertices numbered 0..n-1. Include isolated vertices. n is 0..100 and edges has at most 300 valid pairs; repeated edges and self-loops do not create components or merge one twice. Preserve possibly frozen edges and pairs. A union-find or graph traversal is valid. Target: O(n+m) time and O(n+m) space for graph traversal, where m is edges.length. Union-find has its usual near-linear amortized bound.",
    "starter": "const componentCount = (n, edges) => {\n\n};\n",
    "skeleton": "const componentCount = (n, edges) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Begin with each isolated vertex in its own component; decrement only when two different representatives merge.",
      "Repeated edges and self-loops must not reduce the count again."
    ],
    "approach": [
      "Begin with each isolated vertex in its own component; decrement only when two different representatives merge.",
      "Repeated edges and self-loops must not reduce the count again.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "componentCount(5,[[0,1],[1,2],[3,4]])",
        "expected": 2
      },
      {
        "call": "componentCount(0,[])",
        "expected": 0,
        "edge": true
      },
      {
        "call": "componentCount(4,[])",
        "expected": 4
      },
      {
        "call": "componentCount(3,[[0,1],[0,1],[1,1]])",
        "expected": 2
      },
      {
        "call": "componentCount(3,[[0,1],[1,2],[2,0]])",
        "expected": 1
      }
    ]
  },
  {
    "id": "alg-dsaa-prefix-counts",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 6,
    "tier": 3,
    "focus": [
      "map-set",
      "for-of"
    ],
    "title": "Count words below each prefix",
    "prompt": "Treat words as a set of distinct lowercase ASCII words; repeated entries count once. Return, for each query prefix in order, how many stored words start with it. Empty words and empty prefixes are valid, so the empty prefix counts the whole set. Each input array has at most 128 strings of at most 20 characters. Preserve all inputs. A trie can share prefix state; equivalent implementations are accepted. Target: O(W+C+P+Q) time, where W and P are input array lengths, C is total word characters and Q is total query-prefix characters, under constant-time child lookup.",
    "starter": "const prefixCounts = (words, queries) => {\n\n};\n",
    "skeleton": "const prefixCounts = (words, queries) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Deduplicate complete words before incrementing counts along each prefix path.",
      "The root represents the empty prefix and must count the empty stored word too."
    ],
    "approach": [
      "Deduplicate complete words before incrementing counts along each prefix path.",
      "The root represents the empty prefix and must count the empty stored word too.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "prefixCounts([\"car\",\"cart\",\"cat\"],[\"ca\",\"car\",\"cart\",\"dog\"])",
        "expected": [
          3,
          2,
          1,
          0
        ]
      },
      {
        "call": "prefixCounts([], [\"\"])",
        "expected": [
          0
        ],
        "edge": true
      },
      {
        "call": "prefixCounts([\"a\",\"a\"],[\"a\",\"\"])",
        "expected": [
          1,
          1
        ]
      },
      {
        "call": "prefixCounts([\"\",\"a\"],[\"\",\"a\"])",
        "expected": [
          2,
          1
        ]
      },
      {
        "call": "prefixCounts([\"ab\"],[\"a\",\"ab\",\"abc\"])",
        "expected": [
          1,
          1,
          0
        ]
      }
    ]
  },
  {
    "id": "alg-dsaa-combinations",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 7,
    "tier": 3,
    "focus": [
      "recursion",
      "for"
    ],
    "title": "Enumerate fixed-size combinations",
    "prompt": "Return every size-k increasing combination chosen from integers 1..n, in lexicographic order. n is 0..10 and k is 0..n. Each result row is a fresh array; no result may share a mutable row. The size-zero choice is [[]], including n=0. Return no state from earlier calls. Target: O(K*k+n) time and O(n) extra space for the search, where K is the number of returned combinations. The time bound includes writing the result and is output-sensitive. The output itself may be exponential in n.",
    "starter": "const combinations = (n, k) => {\n\n};\n",
    "skeleton": "const combinations = (n, k) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Choose increasing next values so no permutation or duplicate row is emitted.",
      "Copy the mutable path when it reaches k elements, including the immediate k=0 result."
    ],
    "approach": [
      "Choose increasing next values so no permutation or duplicate row is emitted.",
      "Copy the mutable path when it reaches k elements, including the immediate k=0 result.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 25,
    "tests": [
      {
        "call": "combinations(3,2)",
        "expected": [
          [
            1,
            2
          ],
          [
            1,
            3
          ],
          [
            2,
            3
          ]
        ]
      },
      {
        "call": "combinations(0,0)",
        "expected": [
          []
        ],
        "edge": true
      },
      {
        "call": "combinations(3,0)",
        "expected": [
          []
        ]
      },
      {
        "call": "combinations(3,3)",
        "expected": [
          [
            1,
            2,
            3
          ]
        ]
      },
      {
        "call": "combinations(2,1)",
        "expected": [
          [
            1
          ],
          [
            2
          ]
        ]
      }
    ]
  },
  {
    "id": "alg-dsaa-meeting-selection",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 8,
    "tier": 3,
    "focus": [
      "sort",
      "for"
    ],
    "title": "Select the most compatible meetings",
    "prompt": "Return the maximum number of meetings one person can attend. Each meeting is a nonempty half-open interval [start,end), with integer endpoints in [-1000,1000] and start<end. A meeting ending when another starts is compatible. Input has at most 80 meetings, including possible duplicates; choose at most one instance when they overlap. Leave possibly frozen input and pairs unchanged. Target: O(n log n) time and O(n) space, where n is intervals.length. The earliest-finish greedy method is valid for this count-only objective.",
    "starter": "const maxMeetings = (intervals) => {\n\n};\n",
    "skeleton": "const maxMeetings = (intervals) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Sort a copy by finishing time, then accept a meeting whose start is at least the last accepted end.",
      "This objective counts meetings; a reward-based objective would need a different argument."
    ],
    "approach": [
      "Sort a copy by finishing time, then accept a meeting whose start is at least the last accepted end.",
      "This objective counts meetings; a reward-based objective would need a different argument.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "maxMeetings([[0,10],[1,2],[2,3],[3,4]])",
        "expected": 3
      },
      {
        "call": "maxMeetings([])",
        "expected": 0,
        "edge": true
      },
      {
        "call": "maxMeetings([[1,2],[2,3]])",
        "expected": 2
      },
      {
        "call": "maxMeetings([[1,4],[1,4]])",
        "expected": 1
      },
      {
        "call": "maxMeetings([[-5,-3],[-3,-1]])",
        "expected": 2
      }
    ]
  },
  {
    "id": "alg-dsaa-interval-intersection",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 9,
    "tier": 3,
    "focus": [
      "two-pointer",
      "while"
    ],
    "title": "Intersect two interval lists",
    "prompt": "Return the nonempty intersections of two lists of half-open intervals, sorted by start. Each list is already sorted by start and internally disjoint (touching endpoints are allowed). All intervals are nonempty integer [start,end) pairs within [-1000,1000]; each list has at most 100 intervals. Touching alone produces no output. Return fresh pairs and preserve possibly frozen input and nested pairs. Target: O(n+m) time and O(K) result space, where n,m are input lengths and K is output length.",
    "starter": "const intersectIntervals = (left, right) => {\n\n};\n",
    "skeleton": "const intersectIntervals = (left, right) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Intersect current intervals using the larger start and smaller end; emit only when start<end.",
      "Advance the interval that ends first. Touching input boundaries must not create an empty result."
    ],
    "approach": [
      "Intersect current intervals using the larger start and smaller end; emit only when start<end.",
      "Advance the interval that ends first. Touching input boundaries must not create an empty result.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "intersectIntervals([[0,3],[5,8]],[[1,6]])",
        "expected": [
          [
            1,
            3
          ],
          [
            5,
            6
          ]
        ]
      },
      {
        "call": "intersectIntervals([],[[0,1]])",
        "expected": [],
        "edge": true
      },
      {
        "call": "intersectIntervals([[0,1]],[[1,2]])",
        "expected": []
      },
      {
        "call": "intersectIntervals([[0,10]],[[2,3],[4,5]])",
        "expected": [
          [
            2,
            3
          ],
          [
            4,
            5
          ]
        ]
      },
      {
        "call": "intersectIntervals([[-5,-1]],[[-3,0]])",
        "expected": [
          [
            -3,
            -1
          ]
        ]
      }
    ]
  },
  {
    "id": "alg-dsaa-distinct-window",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 10,
    "tier": 3,
    "focus": [
      "map-set",
      "two-pointer",
      "for"
    ],
    "title": "Find a window with at most k values",
    "prompt": "Return the length of the longest contiguous subarray containing at most k distinct integer values. values is a dense array of at most 200 integers in [-1000,1000]; k is an integer 0..200. Empty input or k=0 returns 0. Preserve the possibly frozen input. Target: O(n) time and O(s+1) extra space under expected constant-time Map operations, where n is values.length and s is the smaller of n and k. The map can temporarily hold one extra distinct value. Equivalent correct results are accepted.",
    "starter": "const longestAtMostK = (values, k) => {\n\n};\n",
    "skeleton": "const longestAtMostK = (values, k) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Expand the right boundary, then shrink until the map has at most k distinct keys.",
      "Remove a key only when its remaining window count becomes zero."
    ],
    "approach": [
      "Expand the right boundary, then shrink until the map has at most k distinct keys.",
      "Remove a key only when its remaining window count becomes zero.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "longestAtMostK([1,2,1,3,2],2)",
        "expected": 3
      },
      {
        "call": "longestAtMostK([],2)",
        "expected": 0,
        "edge": true
      },
      {
        "call": "longestAtMostK([1,1,1],0)",
        "expected": 0
      },
      {
        "call": "longestAtMostK([1,1,1],1)",
        "expected": 3
      },
      {
        "call": "longestAtMostK([1,2,3],5)",
        "expected": 3
      }
    ]
  },
  {
    "id": "alg-dsaa-nonadjacent-sum",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 11,
    "tier": 4,
    "focus": [
      "for",
      "map-set"
    ],
    "title": "Choose nonadjacent rewards",
    "prompt": "Return the largest sum obtainable by choosing nonadjacent positions from values. You may choose no positions, yielding 0. Values are integers in [-1000,1000], in a dense possibly frozen array of at most 200 elements. Preserve all input values and order. Neighboring positions may not both be chosen even when positive; duplicate values at different positions remain separate choices. Target: O(n) time and O(1) extra space using rolling DP state, where n is values.length. A full DP table or memoized recurrence is also valid.",
    "starter": "const nonadjacentSum = values => {\n\n};",
    "skeleton": "const nonadjacentSum = values => {\n  // Compare skipping this position with taking it after a nonadjacent prefix.\n};",
    "hints": [
      "Compare the optimum excluding this position with its value plus the optimum before its immediate neighbor.",
      "The empty selection must remain possible when every reward is negative."
    ],
    "approach": [
      "Start the empty prefix at value 0.",
      "At each position compare skipping it with taking it after the prefix two positions earlier.",
      "Keep only the prior states needed for the next transition, leaving input unchanged."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "nonadjacentSum([2,7,9,3,1])",
        "expected": 12
      },
      {
        "call": "nonadjacentSum([])",
        "expected": 0,
        "edge": true
      },
      {
        "call": "nonadjacentSum([-5,-2])",
        "expected": 0
      },
      {
        "call": "nonadjacentSum([2,3])",
        "expected": 3
      },
      {
        "call": "nonadjacentSum([4,1,4])",
        "expected": 8
      }
    ]
  },
  {
    "id": "alg-dsaa-grid-paths",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 12,
    "tier": 4,
    "focus": [
      "for",
      "recursion"
    ],
    "title": "Count obstacle-avoiding grid paths",
    "prompt": "Return the number of paths from the top-left to bottom-right cell, moving only one cell right or down. A 0 cell is open and a 1 cell is blocked. Empty grid or zero columns returns 0; a blocked endpoint yields0. Otherwise grid is rectangular with at most 15 rows and 15 columns. Preserve possibly frozen rows and outer array. The maximum count fits an exact JavaScript integer. Target: O(r*c) time and O(c) extra space using rolling rows, where r and c are dimensions; a full-table solution is also accepted.",
    "starter": "const gridPaths = (grid) => {\n\n};\n",
    "skeleton": "const gridPaths = (grid) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "A blocked cell resets its path count to zero rather than preserving the previous row’s count.",
      "At an open cell, combine paths from above with the current row’s left neighbor."
    ],
    "approach": [
      "A blocked cell resets its path count to zero rather than preserving the previous row’s count.",
      "At an open cell, combine paths from above with the current row’s left neighbor.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 25,
    "tests": [
      {
        "call": "gridPaths([[0,0,0],[0,1,0],[0,0,0]])",
        "expected": 2
      },
      {
        "call": "gridPaths([])",
        "expected": 0,
        "edge": true
      },
      {
        "call": "gridPaths([[]])",
        "expected": 0
      },
      {
        "call": "gridPaths([[0]])",
        "expected": 1
      },
      {
        "call": "gridPaths([[1]])",
        "expected": 0
      }
    ]
  },
  {
    "id": "alg-dsaa-popcount32",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 13,
    "tier": 4,
    "focus": [
      "while",
      "for"
    ],
    "title": "Count set bits in an unsigned word",
    "prompt": "Return the number of 1 bits in value’s unsigned 32-bit representation. value is an integer in 0..4294967295. Zero returns 0 and 4294967295 returns 32. Number bitwise operators use 32-bit words; avoid a signed-positive loop that stops when the high bit is set. Target: O(b) time and O(1) extra space, counting bit operations on a 32-bit word (b=32). Fixed 32-step and bit-clearing solutions are both valid.",
    "starter": "const popcount32 = (value) => {\n\n};\n",
    "skeleton": "const popcount32 = (value) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Unsigned conversion keeps the high-bit case visible rather than ending a signed-positive loop early.",
      "Clearing the lowest set bit removes exactly one counted bit; zero needs no iterations."
    ],
    "approach": [
      "Unsigned conversion keeps the high-bit case visible rather than ending a signed-positive loop early.",
      "Clearing the lowest set bit removes exactly one counted bit; zero needs no iterations.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 20,
    "tests": [
      {
        "call": "popcount32(0)",
        "expected": 0,
        "edge": true
      },
      {
        "call": "popcount32(1)",
        "expected": 1
      },
      {
        "call": "popcount32(15)",
        "expected": 4
      },
      {
        "call": "popcount32(2147483648)",
        "expected": 1
      },
      {
        "call": "popcount32(4294967295)",
        "expected": 32
      }
    ]
  },
  {
    "id": "alg-dsaa-stable-record-sort",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 14,
    "tier": 4,
    "focus": [
      "recursion",
      "two-pointer",
      "sort"
    ],
    "title": "Preserve ties while sorting records",
    "prompt": "Return a fresh mutable array of the original record objects sorted by ascending numeric key. Equal-key records keep their input order. Each record is {id:string,key:number}; ids are distinct and nonempty and keys are finite integers in[-1000,1000]. There are at most128 records. Never change the input array or objects, which may be frozen; preserve object identity and multiplicity rather than cloning records. Empty input returns[]. A stable merge sort illustrates the proof, and an equivalent stable sort is valid. Target: O(n log n) time and O(n) auxiliary space, where n is records.length.",
    "starter": "const stableRecords = (records) => {\n\n};\n",
    "skeleton": "const stableRecords = (records) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "When equal keys meet during a stable merge, take the item from the earlier left half first.",
      "Keep original object references while creating a fresh outer array, including the empty boundary."
    ],
    "approach": [
      "When equal keys meet during a stable merge, take the item from the earlier left half first.",
      "Keep original object references while creating a fresh outer array, including the empty boundary.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 30,
    "tests": [
      {
        "call": "stableRecords([{id:\"a\",key:2},{id:\"b\",key:1},{id:\"c\",key:2}]).map(x=>x.id)",
        "expected": [
          "b",
          "a",
          "c"
        ]
      },
      {
        "call": "stableRecords([])",
        "expected": [],
        "edge": true
      },
      {
        "call": "stableRecords([{id:\"a\",key:-1}]).map(x=>x.id)",
        "expected": [
          "a"
        ]
      },
      {
        "call": "stableRecords([{id:\"a\",key:0},{id:\"b\",key:0}]).map(x=>x.id)",
        "expected": [
          "a",
          "b"
        ]
      },
      {
        "call": "stableRecords([{id:\"a\",key:10},{id:\"b\",key:2}]).map(x=>x.id)",
        "expected": [
          "b",
          "a"
        ]
      }
    ]
  },
  {
    "id": "alg-dsaa-weighted-schedule",
    "track": "algorithms",
    "topic": "dsa-advanced",
    "level": 15,
    "tier": 4,
    "focus": [
      "sort",
      "while",
      "for"
    ],
    "title": "Choose a maximum-reward schedule",
    "prompt": "Return the greatest total reward of nonoverlapping meetings, choosing any subset, including empty. A meeting is[start,end,reward], occupies the nonempty half-open interval[start,end), and can follow another ending exactly at its start. Endpoints are integers in[-1000,1000], start<end, rewards integers 0..1000, and at most 80 meetings are supplied. Duplicate meetings are separate alternatives but cannot overlap with themselves in the chosen schedule. Preserve possibly frozen inputs and triples. Target: O(n log n) time and O(n) extra space using sorted ends, binary predecessor search and DP, where n is intervals.length. Equivalent correct algorithms are accepted; an earliest-finish count rule does not optimize reward.",
    "starter": "const scheduleReward = (intervals) => {\n\n};\n",
    "skeleton": "const scheduleReward = (intervals) => {\n  // Define the state that preserves the stated invariant.\n  // Handle the empty boundary before processing the remaining input.\n};",
    "hints": [
      "Sort by end time and compare skipping each job with taking its reward plus the compatible prefix optimum.",
      "Binary search must include predecessors ending exactly at the current start."
    ],
    "approach": [
      "Sort by end time and compare skipping each job with taking its reward plus the compatible prefix optimum.",
      "Binary search must include predecessors ending exactly at the current start.",
      "Verify the stated empty boundary and preserve all caller-owned input."
    ],
    "verify": "tests",
    "estimatedMinutes": 35,
    "tests": [
      {
        "call": "scheduleReward([[0,2,2],[2,4,2],[0,4,10]])",
        "expected": 10
      },
      {
        "call": "scheduleReward([])",
        "expected": 0,
        "edge": true
      },
      {
        "call": "scheduleReward([[0,2,4],[2,3,5]])",
        "expected": 9
      },
      {
        "call": "scheduleReward([[0,3,5],[1,2,9]])",
        "expected": 9
      },
      {
        "call": "scheduleReward([[0,1,0]])",
        "expected": 0
      }
    ]
  }
];
