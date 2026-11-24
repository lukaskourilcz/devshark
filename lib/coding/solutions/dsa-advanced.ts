/** Server-only reference, alternate solutions and hidden checks. */
import type { CodingSolution } from '../types';
export const DSA_ADVANCED_SOLUTIONS: Record<string, CodingSolution> = {
  "alg-dsaa-heap-drain": {
    "solution": "const drainHeap = heap => {\n const work=heap.slice(), out=[];\n while(work.length){\n  out.push(work[0]);const last=work.pop();if(!work.length)break;work[0]=last;\n  let i=0;\n  while(2*i+1<work.length){let child=2*i+1;if(child+1<work.length&&work[child+1]<work[child])child++;\n   if(work[i]<=work[child])break;[work[i],work[child]]=[work[child],work[i]];i=child;}\n }\n return out;\n};",
    "junior": "const drainHeap = heap => {const pending=heap.slice();const answer=[];while(pending.length){let at=0;for(let i=1;i<pending.length;i++){if(pending[i]<pending[at])at=i;}answer.push(pending[at]);pending.splice(at,1);}return answer;};",
    "senior": "const drainHeap = heap => heap.toSorted((a,b)=>a-b);",
    "hiddenTests": [
      {
        "label": "each call returns a separately writable result",
        "call": `(() => {
  const input = Object.freeze([1, 4, 2]);
  const first = drainHeap(input);
  const second = drainHeap(input);
  first.push(9);
  return first !== second && first.length === 4 && second.length === 3 && input.length === 3;
})()`,
        "expected": true
      },
      {
        "call": "drainHeap([0,10,1,20,11,2,3])",
        "expected": [
          0,
          1,
          2,
          3,
          10,
          11,
          20
        ]
      },
      {
        "call": "drainHeap([-9,-9,-4,0,-1])",
        "expected": [
          -9,
          -9,
          -4,
          -1,
          0
        ]
      },
      {
        "call": "(() => {const a=[2,3,4];const b=drainHeap(a);return [a,b===a];})()",
        "expected": [
          [
            2,
            3,
            4
          ],
          false
        ]
      },
      {
        "call": "drainHeap([2,10,3,20,15,30,4])",
        "expected": [
          2,
          3,
          4,
          10,
          15,
          20,
          30
        ]
      }
    ]
  },
  "alg-dsaa-adjacency": {
    "solution": "const adjacency = (n, edges) => {const lists=Array.from({length:n},()=>[]);for(const [u,v] of edges)lists[u].push(v);return lists;};",
    "junior": "const adjacency = (n, edges) => {const result=[];for(let v=0;v<n;v++)result.push([]);for(let e=0;e<edges.length;e++){const source=edges[e][0];const target=edges[e][1];result[source].push(target);}return result;};",
    "senior": "const adjacency = (n, edges) => edges.reduce((lists,[from,to])=>(lists[from].push(to),lists),Array.from({length:n},()=>[]));",
    "hiddenTests": [
      {
        "call": "adjacency(4,[[3,0],[1,2],[3,1]])",
        "expected": [
          [],
          [
            2
          ],
          [],
          [
            0,
            1
          ]
        ]
      },
      {
        "call": "adjacency(2,Object.freeze([Object.freeze([1,0])]))",
        "expected": [
          [],
          [
            0
          ]
        ]
      },
      {
        "call": "(() => {const a=adjacency(2,[]);a[0].push(1);return a[1];})()",
        "expected": []
      },
      {
        "call": "adjacency(3,[[2,0],[0,2],[2,1]])",
        "expected": [
          [
            2
          ],
          [],
          [
            0,
            1
          ]
        ]
      }
    ]
  },
  "alg-dsaa-hop-distances": {
    "solution": "const hopDistances = (n,edges,source) => {const g=Array.from({length:n},()=>[]);for(const [u,v] of edges)g[u].push(v);const d=Array(n).fill(-1),q=[source];d[source]=0;for(let head=0;head<q.length;head++){const u=q[head];for(const v of g[u])if(d[v]===-1){d[v]=d[u]+1;q.push(v);}}return d;};",
    "junior": "const hopDistances = (n,edges,source) => {const distance=Array(n).fill(-1);distance[source]=0;let frontier=[source];let depth=0;while(frontier.length){const next=[];for(const from of frontier){for(const edge of edges){if(edge[0]===from&&distance[edge[1]]===-1){distance[edge[1]]=depth+1;next.push(edge[1]);}}}frontier=next;depth++;}return distance;};",
    "senior": "const hopDistances = (n,edges,source) => {const d=Array(n).fill(-1);d[source]=0;for(let round=0;round<n;round++)for(const [u,v] of edges)if(d[u]>=0&&(d[v]<0||d[v]>d[u]+1))d[v]=d[u]+1;return d;};",
    "hiddenTests": [
      {
        "call": "hopDistances(5,[[0,1],[1,2],[2,3],[0,3],[3,4]],0)",
        "expected": [
          0,
          1,
          2,
          1,
          2
        ]
      },
      {
        "call": "hopDistances(3,[[2,2],[2,1],[2,1],[1,0]],2)",
        "expected": [
          2,
          1,
          0
        ]
      },
      {
        "call": "hopDistances(3,Object.freeze([Object.freeze([0,2])]),0)",
        "expected": [
          0,
          -1,
          1
        ]
      },
      {
        "call": "hopDistances(4,[[3,2],[2,1],[1,0]],3)",
        "expected": [
          3,
          2,
          1,
          0
        ]
      }
    ]
  },
  "alg-dsaa-dag-distances": {
    "solution": "const dagDistances=(n,edges,source)=>{const g=Array.from({length:n},()=>[]),indegree=Array(n).fill(0);for(const [u,v,w]of edges){g[u].push([v,w]);indegree[v]++;}const q=[];for(let u=0;u<n;u++)if(indegree[u]===0)q.push(u);const d=Array(n).fill(Infinity);d[source]=0;for(let h=0;h<q.length;h++){const u=q[h];for(const [v,w]of g[u]){d[v]=Math.min(d[v],d[u]+w);if(--indegree[v]===0)q.push(v);}}return d.map(x=>x===Infinity?null:x);};",
    "junior": "const dagDistances=(n,edges,source)=>{const distance=Array(n).fill(Infinity);distance[source]=0;for(let round=1;round<n;round++){let changed=false;for(const [from,to,weight]of edges){if(distance[from]+weight<distance[to]){distance[to]=distance[from]+weight;changed=true;}}if(!changed)break;}return distance.map(value=>Number.isFinite(value)?value:null);};",
    "senior": "const dagDistances=(n,edges,source)=>{const g=Array.from({length:n},()=>[]);for(const [u,v,w]of edges)g[u].push([v,w]);const seen=new Set(),order=[];function visit(u){if(seen.has(u))return;seen.add(u);for(const [v]of g[u])visit(v);order.push(u);}for(let u=0;u<n;u++)visit(u);const d=Array(n).fill(Infinity);d[source]=0;for(const u of order.reverse())for(const [v,w]of g[u])d[v]=Math.min(d[v],d[u]+w);return d.map(x=>Number.isFinite(x)?x:null);};",
    "hiddenTests": [
      {
        "call": "dagDistances(4,[[3,2,-2],[2,0,-4],[3,0,1]],3)",
        "expected": [
          -6,
          null,
          -2,
          0
        ]
      },
      {
        "call": "dagDistances(3,[[1,2,-10]],0)",
        "expected": [
          0,
          null,
          null
        ]
      },
      {
        "call": "dagDistances(2,Object.freeze([Object.freeze([1,0,-1])]),1)",
        "expected": [
          -1,
          0
        ]
      },
      {
        "call": "dagDistances(4,[[0,2,0],[2,1,0],[1,3,0]],0)",
        "expected": [
          0,
          0,
          0,
          0
        ]
      }
    ]
  },
  "alg-dsaa-components": {
    "solution": "const componentCount=(n,edges)=>{const parent=Array.from({length:n},(_,i)=>i),size=Array(n).fill(1);function find(x){while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;}let count=n;for(const [u,v]of edges){const a=find(u),b=find(v);if(a!==b){if(size[a]<size[b]){parent[a]=b;size[b]+=size[a];}else{parent[b]=a;size[a]+=size[b];}count--;}}return count;};",
    "junior": "const componentCount=(n,edges)=>{const neighbors=Array.from({length:n},()=>[]);for(const [a,b]of edges){neighbors[a].push(b);neighbors[b].push(a);}const visited=Array(n).fill(false);let total=0;for(let root=0;root<n;root++){if(visited[root])continue;total++;const stack=[root];visited[root]=true;while(stack.length){const here=stack.pop();for(const next of neighbors[here])if(!visited[next]){visited[next]=true;stack.push(next);}}}return total;};",
    "senior": "const componentCount=(n,edges)=>{const groups=Array.from({length:n},(_,i)=>i);for(const [a,b]of edges){const old=groups[b],target=groups[a];if(old!==target)for(let i=0;i<n;i++)if(groups[i]===old)groups[i]=target;}return new Set(groups).size;};",
    "hiddenTests": [
      {
        "call": "componentCount(6,[[5,0],[4,1],[3,2]])",
        "expected": 3
      },
      {
        "call": "componentCount(1,[[0,0]])",
        "expected": 1
      },
      {
        "call": "componentCount(2,Object.freeze([Object.freeze([1,0])]))",
        "expected": 1
      },
      {
        "call": "componentCount(7,[[0,1],[2,3],[1,2],[4,5],[5,6],[3,4]])",
        "expected": 1
      }
    ]
  },
  "alg-dsaa-prefix-counts": {
    "solution": "const prefixCounts=(words,queries)=>{const root={count:0,children:new Map()};for(const word of new Set(words)){let node=root;node.count++;for(const ch of word){if(!node.children.has(ch))node.children.set(ch,{count:0,children:new Map()});node=node.children.get(ch);node.count++;}}return queries.map(prefix=>{let node=root;for(const ch of prefix){node=node.children.get(ch);if(!node)return 0;}return node.count;});};",
    "junior": "const prefixCounts=(words,queries)=>{const unique=Array.from(new Set(words));const answer=[];for(const prefix of queries){let count=0;for(const word of unique)if(word.startsWith(prefix))count++;answer.push(count);}return answer;};",
    "senior": "const prefixCounts=(words,queries)=>{const counts=new Map();for(const word of new Set(words))for(let length=0;length<=word.length;length++){const prefix=word.slice(0,length);counts.set(prefix,(counts.get(prefix)||0)+1);}return queries.map(prefix=>counts.get(prefix)||0);};",
    "hiddenTests": [
      {
        "call": "prefixCounts([\"one\",\"once\",\"only\"],[\"on\",\"one\",\"once\",\"\"])",
        "expected": [
          3,
          1,
          1,
          3
        ]
      },
      {
        "call": "prefixCounts(Object.freeze([\"x\",\"xy\"]),Object.freeze([\"x\",\"y\"]))",
        "expected": [
          2,
          0
        ]
      },
      {
        "call": "prefixCounts([\"a\"],[])",
        "expected": []
      },
      {
        "call": "prefixCounts([\"\",\"\",\"b\"],[\"\",\"b\",\"bb\"])",
        "expected": [
          2,
          1,
          0
        ]
      }
    ]
  },
  "alg-dsaa-combinations": {
    "solution": "const combinations=(n,k)=>{const out=[],path=[];function visit(start){if(path.length===k){out.push(path.slice());return;}for(let x=start;x<=n-(k-path.length)+1;x++){path.push(x);visit(x+1);path.pop();}}visit(1);return out;};",
    "junior": "const combinations=(n,k)=>{let rows=[[]];for(let size=0;size<k;size++){const next=[];for(const row of rows){const start=row.length?row[row.length-1]+1:1;for(let value=start;value<=n;value++)next.push([...row,value]);}rows=next;}return rows;};",
    "senior": "const combinations=(n,k)=>{const out=[];for(let mask=0;mask<(1<<n);mask++){const row=[];for(let bit=0;bit<n;bit++)if(mask&(1<<bit))row.push(bit+1);if(row.length===k)out.push(row);}return out.sort((a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;});};",
    "hiddenTests": [
      {
        "call": "combinations(4,2)",
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
            1,
            4
          ],
          [
            2,
            3
          ],
          [
            2,
            4
          ],
          [
            3,
            4
          ]
        ]
      },
      {
        "call": "combinations(5,4)",
        "expected": [
          [
            1,
            2,
            3,
            4
          ],
          [
            1,
            2,
            3,
            5
          ],
          [
            1,
            2,
            4,
            5
          ],
          [
            1,
            3,
            4,
            5
          ],
          [
            2,
            3,
            4,
            5
          ]
        ]
      },
      {
        "call": "(() => {const a=combinations(3,1);a[0].push(9);return a.slice(1);})()",
        "expected": [
          [
            2
          ],
          [
            3
          ]
        ]
      },
      {
        "call": "(() => {combinations(4,2);return combinations(1,1);})()",
        "expected": [
          [
            1
          ]
        ]
      }
    ]
  },
  "alg-dsaa-meeting-selection": {
    "solution": "const maxMeetings=intervals=>{const ordered=intervals.slice().sort((a,b)=>a[1]-b[1]||a[0]-b[0]);let end=-Infinity,count=0;for(const interval of ordered)if(interval[0]>=end){count++;end=interval[1];}return count;};",
    "junior": "const maxMeetings=intervals=>{const meetings=intervals.slice().sort((a,b)=>a[1]-b[1]);const best=Array(meetings.length).fill(1);let answer=0;for(let i=0;i<meetings.length;i++){for(let j=0;j<i;j++)if(meetings[j][1]<=meetings[i][0])best[i]=Math.max(best[i],best[j]+1);answer=Math.max(answer,best[i]);}return answer;};",
    "senior": "const maxMeetings=intervals=>intervals.toSorted((a,b)=>a[1]-b[1]).reduce((state,[start,end])=>start>=state.end?{count:state.count+1,end}:state,{count:0,end:-Infinity}).count;",
    "hiddenTests": [
      {
        "call": "maxMeetings([[0,100],[1,20],[2,3],[3,4],[4,5]])",
        "expected": 3
      },
      {
        "call": "maxMeetings(Object.freeze([Object.freeze([3,4]),Object.freeze([0,2])]))",
        "expected": 2
      },
      {
        "call": "maxMeetings([[2,3],[0,1],[1,2],[4,5]])",
        "expected": 4
      },
      {
        "call": "maxMeetings([[0,5],[1,6],[2,7]])",
        "expected": 1
      }
    ]
  },
  "alg-dsaa-interval-intersection": {
    "solution": "const intersectIntervals=(left,right)=>{const out=[];let i=0,j=0;while(i<left.length&&j<right.length){const start=Math.max(left[i][0],right[j][0]),end=Math.min(left[i][1],right[j][1]);if(start<end)out.push([start,end]);if(left[i][1]<right[j][1])i++;else j++;}return out;};",
    "junior": "const intersectIntervals=(left,right)=>{const output=[];for(const a of left)for(const b of right){const start=Math.max(a[0],b[0]);const end=Math.min(a[1],b[1]);if(start<end)output.push([start,end]);}return output;};",
    "senior": "const intersectIntervals=(left,right)=>left.flatMap(a=>right.map(b=>[Math.max(a[0],b[0]),Math.min(a[1],b[1])]).filter(([start,end])=>start<end));",
    "hiddenTests": [
      {
        "call": "intersectIntervals([[0,2],[2,4]],[[1,3]])",
        "expected": [
          [
            1,
            2
          ],
          [
            2,
            3
          ]
        ]
      },
      {
        "call": "intersectIntervals([[0,3],[5,9]],[[0,3],[6,8]])",
        "expected": [
          [
            0,
            3
          ],
          [
            6,
            8
          ]
        ]
      },
      {
        "call": "intersectIntervals(Object.freeze([Object.freeze([0,4])]),Object.freeze([Object.freeze([1,2])]))",
        "expected": [
          [
            1,
            2
          ]
        ]
      },
      {
        "call": "(() => {const a=[[0,4]],b=intersectIntervals(a,[[0,4]]);b[0][0]=9;return a;})()",
        "expected": [
          [
            0,
            4
          ]
        ]
      }
    ]
  },
  "alg-dsaa-distinct-window": {
    "solution": "const longestAtMostK=(values,k)=>{const counts=new Map();let left=0,best=0;for(let right=0;right<values.length;right++){const value=values[right];counts.set(value,(counts.get(value)||0)+1);while(counts.size>k){const old=values[left++],count=counts.get(old)-1;if(count===0)counts.delete(old);else counts.set(old,count);}best=Math.max(best,right-left+1);}return best;};",
    "junior": "const longestAtMostK=(values,k)=>{let best=0;for(let start=0;start<values.length;start++){const seen=new Set();for(let end=start;end<values.length;end++){seen.add(values[end]);if(seen.size>k)break;best=Math.max(best,end-start+1);}}return best;};",
    "senior": "const longestAtMostK=(values,k)=>{if(k===0)return 0;const last=new Map();let start=0,best=0;for(let i=0;i<values.length;i++){last.delete(values[i]);last.set(values[i],i);if(last.size>k){const oldest=last.keys().next().value;start=last.get(oldest)+1;last.delete(oldest);}best=Math.max(best,i-start+1);}return best;};",
    "hiddenTests": [
      {
        "call": "longestAtMostK([1,2,2,3,3,3,2,4],2)",
        "expected": 6
      },
      {
        "call": "longestAtMostK(Object.freeze([-1,0,-1,1]),2)",
        "expected": 3
      },
      {
        "call": "longestAtMostK([1,2,3,4],1)",
        "expected": 1
      },
      {
        "call": "longestAtMostK([2,2,1,3,1,1,3,4],2)",
        "expected": 5
      }
    ]
  },
  "alg-dsaa-grid-paths": {
    "solution": "const gridPaths=grid=>{if(!grid.length||!grid[0].length)return 0;const ways=Array(grid[0].length).fill(0);ways[0]=1;for(let r=0;r<grid.length;r++)for(let c=0;c<ways.length;c++){if(grid[r][c]===1)ways[c]=0;else if(c>0)ways[c]+=ways[c-1];}return ways[ways.length-1];};",
    "junior": "const gridPaths=grid=>{if(grid.length===0||grid[0].length===0)return 0;const table=grid.map(row=>row.map(()=>0));for(let r=0;r<grid.length;r++){for(let c=0;c<grid[0].length;c++){if(grid[r][c]===1)continue;if(r===0&&c===0)table[r][c]=1;else table[r][c]=(r?table[r-1][c]:0)+(c?table[r][c-1]:0);}}return table[table.length-1][table[0].length-1];};",
    "senior": "const gridPaths=grid=>{if(!grid.length||!grid[0].length)return 0;const memo=new Map();function count(r,c){if(r<0||c<0||grid[r][c])return 0;if(r===0&&c===0)return 1;const key=r+','+c;if(!memo.has(key))memo.set(key,count(r-1,c)+count(r,c-1));return memo.get(key);}return count(grid.length-1,grid[0].length-1);};",
    "hiddenTests": [
      {
        "call": "gridPaths([[0,1,0]])",
        "expected": 0
      },
      {
        "call": "gridPaths([[0],[1],[0]])",
        "expected": 0
      },
      {
        "call": "gridPaths(Object.freeze([Object.freeze([0,0]),Object.freeze([0,0])]))",
        "expected": 2
      },
      {
        "call": "gridPaths([[0,0,0],[0,0,0]])",
        "expected": 3
      },
      {
        "call": "gridPaths([[0,0],[0,1]])",
        "expected": 0
      }
    ]
  },
  "alg-dsaa-popcount32": {
    "solution": "const popcount32=value=>{let word=value>>>0,count=0;while(word!==0){word=(word&(word-1))>>>0;count++;}return count;};",
    "junior": "const popcount32=value=>{let count=0;let remaining=value;for(let bit=0;bit<32;bit++){count+=remaining%2;remaining=Math.floor(remaining/2);}return count;};",
    "senior": "const popcount32=value=>{let total=0;for(let bit=0;bit<32;bit++)total+=(value>>>bit)&1;return total;};",
    "hiddenTests": [
      {
        "call": "popcount32(2147483649)",
        "expected": 2
      },
      {
        "call": "popcount32(2863311530)",
        "expected": 16
      },
      {
        "call": "popcount32(4294967294)",
        "expected": 31
      },
      {
        "call": "popcount32(65536)",
        "expected": 1
      }
    ]
  },
  "alg-dsaa-stable-record-sort": {
    "solution": "const stableRecords=records=>{if(records.length<2)return records.slice();const mid=Math.floor(records.length/2),left=stableRecords(records.slice(0,mid)),right=stableRecords(records.slice(mid)),out=[];let i=0,j=0;while(i<left.length&&j<right.length){if(left[i].key<=right[j].key)out.push(left[i++]);else out.push(right[j++]);}return out.concat(left.slice(i),right.slice(j));};",
    "junior": "const stableRecords=records=>{const result=[];for(const record of records){let at=result.length;while(at>0&&result[at-1].key>record.key)at--;result.splice(at,0,record);}return result;};",
    "senior": "const stableRecords=records=>records.toSorted((a,b)=>a.key-b.key);",
    "hiddenTests": [
      {
        "label": "nonempty result arrays are independently writable and retain their record references",
        "call": `(() => {
  const a = Object.freeze({ id: 'a', key: 1 });
  const b = Object.freeze({ id: 'b', key: 0 });
  const input = Object.freeze([a, b]);
  const first = stableRecords(input);
  const second = stableRecords(input);
  first.pop();
  return first !== second && first.length === 1 && first[0] === b &&
    second.length === 2 && second[0] === b && second[1] === a && input[0] === a;
})()`,
        "expected": true
      },
      {
        "call": "stableRecords([{id:\"z\",key:1},{id:\"y\",key:0},{id:\"x\",key:1},{id:\"w\",key:0}]).map(x=>x.id)",
        "expected": [
          "y",
          "w",
          "z",
          "x"
        ]
      },
      {
        "call": "(() => {const a=Object.freeze({id:\"a\",key:1}),b=Object.freeze({id:\"b\",key:0});const input=Object.freeze([a,b]);const out=stableRecords(input);return [out[0]===b,out[1]===a,out!==input,input[0].id];})()",
        "expected": [
          true,
          true,
          true,
          "a"
        ]
      },
      {
        "call": "stableRecords([{id:\"a\",key:-5},{id:\"b\",key:5},{id:\"c\",key:0}]).map(x=>x.id)",
        "expected": [
          "a",
          "c",
          "b"
        ]
      },
      {
        "call": "(() => {const a=[];const b=stableRecords(a);b.push({id:\"x\",key:0});return a;})()",
        "expected": []
      }
    ]
  },
  "alg-dsaa-weighted-schedule": {
    "solution": "const scheduleReward=intervals=>{const jobs=intervals.slice().sort((a,b)=>a[1]-b[1]);const best=Array(jobs.length+1).fill(0);for(let i=0;i<jobs.length;i++){let lo=0,hi=i;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(jobs[mid][1]<=jobs[i][0])lo=mid+1;else hi=mid;}best[i+1]=Math.max(best[i],best[lo]+jobs[i][2]);}return best[jobs.length];};",
    "junior": "const scheduleReward=intervals=>{const jobs=intervals.slice().sort((a,b)=>a[1]-b[1]);const ending=Array(jobs.length).fill(0);let answer=0;for(let i=0;i<jobs.length;i++){ending[i]=jobs[i][2];for(let j=0;j<i;j++)if(jobs[j][1]<=jobs[i][0])ending[i]=Math.max(ending[i],ending[j]+jobs[i][2]);answer=Math.max(answer,ending[i]);}return answer;};",
    "senior": "const scheduleReward=intervals=>{const jobs=intervals.toSorted((a,b)=>a[0]-b[0]);const memo=new Map();function best(i){if(i===jobs.length)return 0;if(memo.has(i))return memo.get(i);let lo=i+1,hi=jobs.length;while(lo<hi){const m=(lo+hi)>>1;if(jobs[m][0]<jobs[i][1])lo=m+1;else hi=m;}const result=Math.max(best(i+1),jobs[i][2]+best(lo));memo.set(i,result);return result;}return best(0);};",
    "hiddenTests": [
      {
        "call": "scheduleReward([[0,2,6],[2,4,6],[0,4,11]])",
        "expected": 12
      },
      {
        "call": "scheduleReward(Object.freeze([Object.freeze([-2,0,7]),Object.freeze([0,1,3])]))",
        "expected": 10
      },
      {
        "call": "scheduleReward([[0,2,5],[0,2,5],[2,3,1]])",
        "expected": 6
      },
      {
        "call": "scheduleReward([[5,7,8],[0,2,4],[2,5,7]])",
        "expected": 19
      }
    ]
  },
  "alg-dsaa-nonadjacent-sum": {
    "solution": "const nonadjacentSum=values=>{let skip=0,take=-Infinity;for(const value of values){const nextTake=skip+value;skip=Math.max(skip,take);take=nextTake;}return Math.max(skip,take);};",
    "junior": "const nonadjacentSum=values=>{const best=Array(values.length+1).fill(0);for(let i=0;i<values.length;i++){const beforeNeighbor=i>0?best[i-1]:0;best[i+1]=Math.max(best[i],beforeNeighbor+values[i]);}return best[values.length];};",
    "senior": "const nonadjacentSum=values=>{const memo=new Map();function best(i){if(i>=values.length)return 0;if(!memo.has(i))memo.set(i,Math.max(best(i+1),values[i]+best(i+2)));return memo.get(i);}return best(0);};",
    "hiddenTests": [
      {
        "call": "nonadjacentSum(Object.freeze([5,1,1,5]))",
        "expected": 10
      },
      {
        "call": "nonadjacentSum([0,0,0])",
        "expected": 0
      },
      {
        "call": "nonadjacentSum([-3,4,-2,4,-1])",
        "expected": 8
      },
      {
        "call": "nonadjacentSum([1,10,1,1,10])",
        "expected": 20
      },
      {
        "call": "nonadjacentSum([-1000])",
        "expected": 0
      }
    ]
  }
};
