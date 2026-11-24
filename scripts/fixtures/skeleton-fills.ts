/** Skeleton hint rungs, filled in. Each entry completes a task's skeleton
 * the way its comments and the rungs before it ask: every line of the
 * skeleton is still there, in order, and each comment has been replaced by
 * code. The content contract checks both halves: that the entry still fits
 * the skeleton, and that it passes every visible and hidden check. A
 * skeleton that points somewhere a pass cannot follow (a const the learner
 * must reassign, a loop over a number, rows the suite does not count) has no
 * entry that does both. Server-side test data only: these are answers. */
export const SKELETON_FILLS: Record<string, string> = {
  'alg-retry-backoff': `const retryWithBackoff = async (fn, attempts) => {
  const wait = ms => new Promise(done => setTimeout(done, ms));
  let lastError = new Error("no attempts were made");

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(100 * 2 ** (attempt - 1));
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};
`,
  'alg-valid-palindrome': `const isPalindrome = text => {
  let left = 0;
  let right = text.length - 1;
  const keep = /[a-z0-9]/i;

  while (left < right) {
    if (!keep.test(text[left])) { left += 1; continue; }
    if (!keep.test(text[right])) { right -= 1; continue; }
    if (text[left].toLowerCase() !== text[right].toLowerCase()) return false;
    left += 1;
    right -= 1;
  }

  return true;
};
`,
  'js-average': `const average = numbers => {
  if (numbers.length === 0) return 0;
  const total = numbers.reduce((sum, number) => sum + number, 0);
  return total / numbers.length;
};
`,
  'js-clone-promise-all': `const promiseAll = promises => {
  const inputs = Array.from(promises); // captures length and fills holes
  return new Promise((resolve, reject) => {
    const results = [];
    let arrived = 0;
    if (inputs.length === 0) resolve(results);
    inputs.forEach((item, index) => {
      Promise.resolve(item).then(value => {
        results[index] = value;
        arrived += 1;
        if (arrived === inputs.length) resolve(results);
      }, reject);
    });
  });
};
`,
  'js-count-vowels': `const countVowels = text => {
  let count = 0;

  for (const letter of text) {
    if ("aeiouAEIOU".includes(letter)) count += 1;
  }

  return count;
};
`,
  'js-countdown': `const countDown = n => {
  const result = [];

  while (n > 0) {
    result.push(n);
    n -= 1;
  }

  return result;
};
`,
  'js-easy2-reverse-vowels': `const reverseVowels = text => {
  const chars = text.split("");
  let left = 0;
  let right = chars.length - 1;
  const isVowel = char => "aeiouAEIOU".includes(char);

  while (left < right) {
    if (!isVowel(chars[left])) {
      left++;
    } else if (!isVowel(chars[right])) {
      right--;
    } else {
      [chars[left], chars[right]] = [chars[right], chars[left]];
      left++;
      right--;
    }
  }

  return chars.join("");
};
`,
  'js-fizz-values': `const fizz = n => {
  const numbers = Array.from({ length: n }, (_, index) => index + 1);
  return numbers.map(number => number % 3 === 0 ? "Fizz" : number);
};
`,
  'js-largest-number': `const largest = numbers => {
  let best = numbers[0];

  for (const number of numbers) {
    if (number > best) best = number;
  }

  return best;
};
`,
  'js-letter-counts': `const countLetters = text => {
  const counts = {};

  for (const letter of text) {
    counts[letter] = (counts[letter] ?? 0) + 1;
  }

  return counts;
};
`,
  'js-longest-word': `const longest = words => {
  let best = "";

  for (const word of words) {
    if (word.length > best.length) best = word;
  }

  return best;
};
`,
  'js-lru-cache': `const LRUCache = strArr => {
  const cache = [];

  for (const letter of strArr) {
    const at = cache.indexOf(letter);
    if (at !== -1) cache.splice(at, 1);
    cache.push(letter);
    while (cache.length > 5) cache.shift();
  }

  return cache.join("-");
};
`,
  'js-number-range': `const range = (start, end) => {
  const result = [];

  for (let value = start; value <= end; value += 1) {
    result.push(value);
  }

  return result;
};
`,
  'js-repeat-word': `const repeat = (word, times) => {
  const copies = [];

  for (let count = 0; count < times; count += 1) {
    copies.push(word);
  }

  return copies.join(" ");
};
`,
  'js-reverse-string': `const reverse = text => {
  const letters = Array.from(text);
  // reverse letters, then join them back into one string
  return letters.reverse().join("");
};
`,
  'react-abort-a-request': `import React, { useEffect, useState } from 'react';

const App = () => {
  const API_URL = 'https://jsonplaceholder.typicode.com/posts';
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const loadItems = async () => {
      try {
        const response = await fetch(API_URL, { signal: controller.signal });
        if (!response.ok) throw new Error('Request failed');
        const data = await response.json();
        if (active) setItems(data);
      } catch (requestError) {
        if (requestError.name === 'AbortError') return;
        if (active) setError('Could not load posts.');
      }
    };

    loadItems();

    return () => { active = false; controller.abort(); };
  }, []);

  return (
    <main>
      <h2>Abort a request</h2>
      {error && <p role="alert">{error}</p>}
      <p>{items.length} posts</p>
    </main>
  );
};

export default App;
`,
  'react-accordion': `import React, { useState, useId } from 'react';

const sections = [
  { id: 1, title: 'Shipping', body: 'Ships within two days' },
  { id: 2, title: 'Returns', body: 'Returns stay open for thirty days' },
  { id: 3, title: 'Support', body: 'Support answers every weekday' },
];

const App = () => {
  const [openId, setOpenId] = useState(null);
  const idPrefix = useId();

  const toggle = id => {
    setOpenId(current => (current === id ? null : id));
  };

  return (
    <main>
      <h2>Accordion</h2>
      {sections.map(section => (
        <section key={section.id}>
          <h3><button type="button" aria-expanded={openId === section.id} aria-controls={idPrefix + '-' + section.id} onClick={() => toggle(section.id)}>{section.title}</button></h3>
          {openId === section.id && <p id={idPrefix + '-' + section.id}>{section.body}</p>}
        </section>
      ))}
    </main>
  );
};

export default App;
`,
  'react-add-a-todo': `import React, { useState } from 'react';

const App = () => {
  const [text, setText] = useState('');
  const [todos, setTodos] = useState([]);

  const addTodo = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setTodos(current => [...current, { id: crypto.randomUUID(), text: trimmed }]);
    setText('');
  };

  return (
    <main>
      <h2>Add a todo</h2>
      <input aria-label="New todo" value={text} onChange={event => setText(event.target.value)} />
      <button onClick={addTodo}>Add</button>
      <ul>
        {todos.map(todo => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-color-selector': `import React, { useState } from 'react';

const colors = ['Red', 'Blue', 'Green'];

const App = () => {
  const [color, setColor] = useState(colors[0]);

  return (
    <main>
      <h2>Color selector</h2>
      <select aria-label="Color" value={color} onChange={event => setColor(event.target.value)}>
        {colors.map(one => (
          <option key={one}>{one}</option>
        ))}
      </select>
      <p>You have selected: {color}</p>
    </main>
  );
};

export default App;
`,
  'react-data-list': `import React from 'react';

const initialPeople = [
  { id: 1, name: 'Daniel', age: 25 },
  { id: 2, name: 'John', age: 24 },
];

const App = ({ people = initialPeople } = {}) => (
  <main>
    <h2>Data list</h2>
    <ul>
      {people.map(person => (
        <li key={person.id}>{person.name} {person.age}</li>
      ))}
    </ul>
  </main>
);

export default App;
`,
  'react-dependent-fetch': `import React, { useEffect, useState } from 'react';

const App = () => {
  const [selectedId, setSelectedId] = useState(1);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setItems([]);
    setError('');
    const load = async () => {
      try {
        const response = await fetch(\`https://jsonplaceholder.typicode.com/posts?userId=\${selectedId}\`);
        if (!response.ok) throw new Error('Request failed');
        const data = await response.json();
        if (active) setItems(data);
      } catch {
        if (active) setError('Could not load posts.');
      }
    };
    load();
    return () => { active = false; };
  }, [selectedId]);

  return (
    <main>
      <h2>Dependent fetch</h2>
      <select aria-label="Author" value={selectedId} onChange={event => setSelectedId(Number(event.target.value))}>
        <option value="1">User 1</option>
        <option value="2">User 2</option>
      </select>
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map(item => <li key={item.id}>{item.title}</li>)}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-fetch-error-state': `import React, { useEffect, useState } from 'react';

const App = () => {
  const API_URL = 'https://jsonplaceholder.typicode.com/users';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadItems = async () => {
      try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error('Request failed');
        const data = await response.json();
        setItems(data);
      } catch (requestError) {
        setError('Could not load users');
      } finally {
        setLoading(false);
      }
    };

    loadItems();
  }, []);
  const visibleItems = items;

  if (error) return <p role="alert">{error}</p>;

  return (
    <main>
      <h2>Fetch error state</h2>
      {loading && <p>Loading…</p>}
      <ul>
        {visibleItems.map(item => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-filter-fetched-users': `import React, { useEffect, useState } from 'react';

const App = () => {
  const API_URL = 'https://jsonplaceholder.typicode.com/users';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    const loadItems = async () => {
      try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error('Request failed');
        const data = await response.json();
        if (active) setItems(data);
      } catch (requestError) {
        if (active) setError('Could not load users.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadItems();
    return () => { active = false; };
  }, []);
  const visibleItems = items.filter(item =>
    item.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <main>
      <h2>Filter fetched users</h2>
      {loading && <p role="status">Loading users…</p>}
      {error && <p role="alert">{error}</p>}
      <input aria-label="Filter users" value={query} onChange={event => setQuery(event.target.value)} />
      <ul>
        {visibleItems.map(item => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-get-users-list': `import React, { useEffect, useState } from 'react';

const App = () => {
  const API_URL = 'https://jsonplaceholder.typicode.com/users';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const loadItems = async () => {
      try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error('Request failed');
        const data = await response.json();
        if (active) setItems(data);
      } catch (requestError) {
        if (active) setError('Could not load users.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadItems();
    return () => { active = false; };
  }, []);
  const visibleItems = items;

  return (
    <main>
      <h2>GET users list</h2>
      {loading && <p role="status">Loading…</p>}
      {error && <p role="alert">{error}</p>}
      <ul>
        {visibleItems.map(item => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-live-paragraph': `import React, { useState } from 'react';

const App = () => {
  const [text, setText] = useState('');

  return (
    <main>
      <h2>Live paragraph</h2>
      <label>Your text
      <input value={text} onChange={event => setText(event.target.value)} />
      </label>
      <p>{text}</p>
    </main>
  );
};

export default App;
`,
  'react-loading-state': `import React, { useEffect, useState } from 'react';

const App = () => {
  const API_URL = 'https://jsonplaceholder.typicode.com/users';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const loadItems = async () => {
      try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error('Request failed');
        const data = await response.json();
        if (active) setItems(data);
      } catch (requestError) {
        if (active) setError('Could not load users.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadItems();
    return () => { active = false; };
  }, []);
  const visibleItems = items;

  if (loading) return <p role="status">Loading…</p>;

  return (
    <main>
      {error && <p role="alert">{error}</p>}
      <ul>
        {visibleItems.map(item => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-mh-wait-for-export': `import React, { useEffect, useState } from 'react';

const App = () => {
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);

  const start = () => {
    setJob(null);
    setStarting(true);
    fetch('/api/exports', { method: 'POST' })
      .then((response) => response.json())
      .then((answer) => {
        setStarting(false);
        setJobId(answer.id);
      });
  };

  useEffect(() => {
    if (jobId === null) return;
    let stopped = false;
    let timer;
    const ask = () => {
      fetch('/api/exports/' + jobId)
        .then((response) => response.json())
        .then((answer) => {
          if (stopped) return;
          setJob(answer);
          if (answer.status === 'running') timer = setTimeout(ask, 200);
        });
    };
    ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const running = starting || (jobId !== null && (job === null || job.status === 'running'));

  return <main>
    <h2>Export the report</h2>
    <button type="button" onClick={start} disabled={running}>Export</button>
    {job && job.status === 'running' && <p>Preparing… {job.progress}%</p>}
    {job && job.status === 'done' && <a href={job.url}>Download the export</a>}
    {job && job.status === 'failed' && <p role="alert">The export failed</p>}
  </main>;
};

export default App;
`,
  'react-modal': `import React, { useEffect, useState } from 'react';

const App = () => {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = event => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <main>
      <h2>Modal</h2>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <div className="backdrop" onClick={close}>
          <div role="dialog" onClick={event => event.stopPropagation()}>
            <button onClick={close}>Close</button>
          </div>
        </div>
      )}
    </main>
  );
};

export default App;
`,
  'react-paginated-posts': `import React, { useEffect, useState } from 'react';

const App = () => {
  const API_URL = 'https://jsonplaceholder.typicode.com/posts';
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setItems([]);
    setStatus('loading');
    const loadItems = async () => {
      try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error('Request failed');
        const data = await response.json();
        if (!active) return;
        setItems(data);
        setStatus('ready');
      } catch {
        if (active) setStatus('error');
      }
    };
    loadItems();
    return () => { active = false; };
  }, [attempt]);

  const pageItems = items.slice((page - 1) * pageSize, page * pageSize);

  return (
    <main>
      <h2>Paginated posts</h2>
      {status === 'loading' && <p role="status">Loading…</p>}
      {status === 'error' && <><p role="alert">Could not load posts</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></>}
      <ul>
        {pageItems.map(item => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>

      <button type="button" disabled={page === 1} onClick={() => setPage(current => current - 1)}>Previous</button>
      <button type="button" disabled={page * pageSize >= items.length} onClick={() => setPage(current => current + 1)}>Next</button>
    </main>
  );
};

export default App;
`,
  'react-product-search': `import React, { useEffect, useState } from 'react';

const App = () => {
  const API_URL = 'https://dummyjson.com/products';
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const loadProducts = async () => {
      const response = await fetch(API_URL);
      const data = await response.json();
      setProducts(data.products);
    };

    loadProducts();
  }, []);

  const term = search.toLowerCase();
  const shown = products.filter(product => product.title.toLowerCase().includes(term) || product.category.toLowerCase().includes(term));
  const total = shown.reduce((sum, product) => sum + product.price, 0);

  return (
    <main>
      <h2>Product search</h2>
      <p>Total: {total}</p>
      <input value={search} onChange={event => setSearch(event.target.value)} />
      <ul>
        {shown.map(product => (
          <li key={product.id}>{product.title} — {product.price} — {product.category}</li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-remove-a-todo': `import React, { useState } from 'react';

const initialTodos = [
  { id: 1, text: 'Practice hooks' },
  { id: 2, text: 'Read the docs' },
  { id: 3, text: 'Ship the app' },
];

const App = () => {
  const [todos, setTodos] = useState(initialTodos);

  const removeTodo = id => {
    setTodos(current => current.filter(todo => todo.id !== id));
  };

  return (
    <main>
      <h2>Remove a todo</h2>
      <ul>
        {todos.map(todo => (
          <li key={todo.id}>
            {todo.text} <button aria-label={'Remove ' + todo.text} onClick={() => removeTodo(todo.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-search-a-list': `import React, { useState } from 'react';

const names = ['Ana', 'Daniel', 'John'];

const App = () => {
  const [query, setQuery] = useState('');
  const visibleNames = names.filter(name => name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <main>
      <h2>Search a list</h2>
      <input aria-label="Search names" value={query} onChange={event => setQuery(event.target.value)} />
      <ul>
        {visibleNames.map(name => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-star-rating': `import React, { useState } from 'react';

const stars = [1, 2, 3, 4, 5];

const App = () => {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const shown = hovered || rating;

  return (
    <main>
      <h2>Star rating</h2>
      <div onMouseLeave={() => setHovered(0)}>
        {stars.map(star => (
          <button key={star} type="button" aria-label={'Rate ' + star + ' star' + (star === 1 ? '' : 's')} onMouseEnter={() => setHovered(star)} onClick={() => setRating(star)}>
            {star <= shown ? '★' : '☆'}
          </button>
        ))}
      </div>
      <p>Rating: {rating}</p>
    </main>
  );
};

export default App;
`,
  'react-stopwatch': `import React, { useEffect, useState } from 'react';

const App = () => {
  const [seconds, setSeconds] = useState(0);
  const timerRef = React.useRef(null);

  const start = () => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => setSeconds(current => current + 1), 1000);
  };

  const stop = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const reset = () => {
    stop();
    setSeconds(0);
  };

  useEffect(() => stop, []);

  return (
    <main>
      <h2>Stopwatch</h2>
      <p>{seconds}s</p>
      <button onClick={start}>Start</button>
      <button onClick={stop}>Stop</button>
      <button onClick={reset}>Reset</button>
    </main>
  );
};

export default App;
`,
  'react-tabs': `import React, { useId, useState } from 'react';

const tabs = [
  { id: 'profile', label: 'Profile', panel: 'Profile details' },
  { id: 'billing', label: 'Billing', panel: 'Billing details' },
  { id: 'alerts', label: 'Alerts', panel: 'Alert settings' },
];

const App = () => {
  const [activeId, setActiveId] = useState(tabs[0].id);
  const idPrefix = useId();
  const active = tabs.find(tab => tab.id === activeId);

  const onKeyDown = event => {
    const buttons = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
    const current = buttons.indexOf(event.target);
    if (current < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveId(tabs[next].id);
    buttons[next].focus();
  };

  return (
    <main>
      <div role="tablist" aria-label="Account" onKeyDown={onKeyDown}>
        {tabs.map(tab => (
          <button key={tab.id} type="button" role="tab" id={idPrefix + '-tab-' + tab.id}
            aria-controls={idPrefix + '-panel-' + tab.id}
            aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1}
            onFocus={() => setActiveId(tab.id)} onClick={() => setActiveId(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={idPrefix + '-panel-' + active.id}
        aria-labelledby={idPrefix + '-tab-' + active.id} tabIndex={0}>{active.panel}</div>
    </main>
  );
};

export default App;`,

  'react-theme-context': `import React, { useEffect, useState } from 'react';

const ThemeContext = React.createContext(null);

const ThemeToggle = () => {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  return <button onClick={toggleTheme}>Theme: {theme}</button>;
};

const Toolbar = () => <section><ThemeToggle /></section>;

const App = () => {
  const [theme, setTheme] = useState('light');
  const toggleTheme = () => setTheme(current => (current === 'light' ? 'dark' : 'light'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <main>
        <h2>Theme context</h2>
        <Toolbar />
      </main>
    </ThemeContext.Provider>
  );
};

export default App;
`,
  'react-todo-client': `import React, { useEffect, useState } from 'react';

// SYSTEM DESIGN NOTES
// User flow: load five todos, tick or delete them locally, add one through the API.
// Data model: Todo { id, userId, title, completed }; the completed count is derived.
// API endpoints: GET /todos?_limit=5, POST /todos.
// Reliability and scale: two tabs editing one todo would need a version per todo;
// the server answers 409 when the version is stale, and the client reloads it.

const App = () => {
  const TODOS_URL = 'https://jsonplaceholder.typicode.com/todos';
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const nextCreatedKey = React.useRef(1);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(TODOS_URL + '?_limit=5');
        if (!response.ok) throw new Error('Could not load the todos');
        const rows = await response.json();
        setTodos(rows.map(todo => ({ ...todo, rowKey: 'loaded-' + todo.id })));
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const addTodo = async event => {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    try {
      const response = await fetch(TODOS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text, completed: false, userId: 1 }),
      });
      if (!response.ok) throw new Error('Could not add the todo');
      const created = await response.json();
      const row = { ...created, rowKey: 'created-' + nextCreatedKey.current++ };
      setTodos(current => [...current, row]);
      setTitle('');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const toggle = id => setTodos(current => current.map(todo => todo.rowKey === id ? { ...todo, completed: !todo.completed } : todo));
  const remove = id => setTodos(current => current.filter(todo => todo.rowKey !== id));
  const done = todos.filter(todo => todo.completed).length;

  if (loading) return <p>Loading todos…</p>;

  return (
    <main>
      <h2>Todo client</h2>
      {error && <p role="alert">{error}</p>}
      <p>Completed: {done} of {todos.length}</p>
      <form onSubmit={addTodo}>
        <input type="text" value={title} onChange={event => setTitle(event.target.value)} />
        <button type="submit">Add</button>
      </form>
      <ul>
        {todos.map(todo => (
          <li key={todo.rowKey}>
            <input type="checkbox" checked={todo.completed} onChange={() => toggle(todo.rowKey)} /> {todo.title}
            <button type="button" onClick={() => remove(todo.rowKey)}>Delete</button>
          </li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-todo-dashboard': `import React, { useEffect, useState } from 'react';

const App = () => {
  const API_URL = 'https://jsonplaceholder.typicode.com/todos?_limit=3';
  const [todos, setTodos] = useState([]);
  const [title, setTitle] = useState('');

  useEffect(() => {
    const loadTodos = async () => {
      const response = await fetch(API_URL);
      setTodos(await response.json());
    };

    loadTodos();
  }, []);

  const done = todos.filter(todo => todo.completed).length;

  const add = () => {
    if (!title.trim()) return;
    setTodos(current => [...current, { id: crypto.randomUUID(), title, completed: false }]);
    setTitle('');
  };

  const remove = id => {
    setTodos(current => current.filter(todo => todo.id !== id));
  };

  return (
    <main>
      <h2>Todo dashboard</h2>
      <p>Done: {done} of {todos.length}</p>
      <input value={title} onChange={event => setTitle(event.target.value)} />
      <button onClick={add}>Add</button>
      <ul>
        {todos.map(todo => (
          <li key={todo.id}>
            {todo.title} — {todo.completed ? 'done' : 'to do'}
            <button onClick={() => remove(todo.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-usedebounce-hook': `import React, { useEffect, useState } from 'react';

const fruits = ['Apple', 'Banana', 'Cherry'];

export const useDebounce = (value, delay) => {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return settled;
};

const App = () => {
  const [query, setQuery] = useState('');
  const settledQuery = useDebounce(query, 300);
  const visible = fruits.filter(fruit => fruit.toLowerCase().includes(settledQuery.toLowerCase()));

  return (
    <main>
      <h2>useDebounce hook</h2>
      <input aria-label="Filter fruit" value={query} onChange={event => setQuery(event.target.value)} />
      <ul>
        {visible.map(fruit => (
          <li key={fruit}>{fruit}</li>
        ))}
      </ul>
    </main>
  );
};

export default App;
`,
  'react-uselocalstorage-hook': `import React, { useEffect, useState } from 'react';

export const useLocalStorage = (key, initial) => {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : JSON.parse(stored);
    } catch { return initial; }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Continue in memory. */ }
  }, [key, value]);

  return [value, setValue];
};

const App = () => {
  const [count, setCount] = useLocalStorage('count', 0);

  return (
    <main>
      <h2>useLocalStorage hook</h2>
      <p>Count: {count}</p>
      <button onClick={() => setCount(current => current + 1)}>Increment</button>
    </main>
  );
};

export default App;
`,
  'ts-easy2-where-a-value-sits': `const spanOf = (sorted: readonly number[], value: number): [number, number] | null => {
  let start = 0;
  let end = sorted.length - 1;
  while (start <= end && sorted[start] !== value) start++;
  if (start > end) return null;
  while (sorted[end] !== value) end--;
  return [start, end];
};
`,
};
