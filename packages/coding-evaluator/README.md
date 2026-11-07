# @lukaskourilcz/coding-evaluator

The evaluator behind the **Run** button in [devShark](https://devshark.app)'s
coding exercises. It runs a learner's JavaScript, calls it with authored call
expressions, compares each result with the expected value, captures console
output within fixed caps, and names why an attempt failed.

The sources are devShark's own `shared/coding-*.ts` modules, bundled as they
are, so the package and the app cannot drift apart.

## Install

The package is published to GitHub Packages. Point the scope at it once:

```sh
echo "@lukaskourilcz:registry=https://npm.pkg.github.com" >> .npmrc
npm install @lukaskourilcz/coding-evaluator
```

GitHub Packages asks for a token with `read:packages` even for public packages.

## Use

```ts
import { evaluateCalls, allPassed, classifyFailure, failureHint } from '@lukaskourilcz/coding-evaluator';

const run = await evaluateCalls({
  code: 'function add(a, b) { return a + b; }',
  calls: ['add(1, 2)', 'add(2, 2)'],
  expectations: [3, 5],
});

run.results;        // [{ pass: true, actual: '3', error: null }, { pass: false, actual: '4', error: null }]
allPassed(run);     // false

const category = classifyFailure({ results: run.results }); // 'tests'
failureHint('missing-return', undefined)?.body;             // authored hint text
```

Leave out `expectations` to run without grading: every call then reports what it
returned with `pass: null`. Calls are awaited, so a promise is graded on what it
resolves to.

| Export | What it does |
| --- | --- |
| `evaluateCalls` | Runs code once and evaluates each call in its scope. |
| `allPassed` | True when a graded run finished and every case passed. |
| `deepEqual` | Structural equality; `NaN` equals `NaN`, `0` equals `-0`. |
| `displayValue` | Renders a value the way the results table shows it (keeps `-0`). |
| `learnerConsoleFactory` | The `console` learner code sees: `log`, `table`, `group`, `count`, `time`, `assert` and more. |
| `classifyFailure`, `failureHint` | Turn run signals into one of eight failure categories and its hint. |
| `createMiniJest` | A small jest-shaped runner (`describe`, `test`, `expect`, hooks). |

## Not a sandbox

`evaluateCalls` runs code in the realm that calls it. devShark calls it inside a
dedicated Web Worker with the risky globals removed, and grades submissions on
the server in a separate QuickJS sandbox. Do the same: never run untrusted code
with this package on a page or a server that holds anything worth protecting.

## Develop

From this folder, with the app's dependencies installed at the repository root:

```sh
npm run build   # dist/index.js, dist/index.cjs and the type declarations
npm test        # smoke tests against the built bundle
```

Releases are published by `.github/workflows/packages.yml` when a
`coding-evaluator-v*` tag is pushed.

## License

MIT, for the files in this package only.
