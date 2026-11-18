// Runs the SQL behaviour suite against a real Postgres.
//
// It builds the schema the way production got it — supabase/supabase-schema.sql,
// then every numbered migration in order — and then runs each
// supabase/tests/*.test.sql file in its own transaction that is rolled back.
// A test file fails when psql stops on an error: a failed ASSERT, a RAISE, or
// any SQL error.
//
// DATABASE_URL must point at an EMPTY database (a fresh `supabase/postgres`
// container): the script refuses to touch a database that already has tables
// in `public`, so it can never run against a real project.
//
//   docker run -d --name devshark-sql -p 54339:5432 -e POSTGRES_PASSWORD=postgres supabase/postgres:17.6.1.171
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54339/postgres npm run test:sql
//
// supabase/tests/known-failures.txt lists test files that fail today because of
// a known, tracked bug, each with the text its failure must contain. They still
// run: a listed file that fails with that text is reported as an expected
// failure; one that fails any other way fails the suite, and so does one that
// passes, until its line is removed. The list can only shrink.
//
// Every schema file must close the transaction it opens: psql rolls an open one
// back when it exits, without an error, so a file that forgets COMMIT changes
// nothing and still "applies". Files from 077 on (MIGRATION_RULES_FROM) must
// also start with BEGIN, set lock_timeout and statement_timeout right after it,
// end with COMMIT, and apply a second time without an error and without
// changing the catalog or any table's row count. Production applied 002 to 076
// before these rules, so they keep their shape.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('test:sql needs DATABASE_URL pointing at an empty Postgres database (see scripts/test-sql.mjs).');
  process.exit(2);
}

// Relative paths, so psql names files the way the repository does.
const schemaDir = 'supabase';
const testDir = join(schemaDir, 'tests');

// The first migration number checkMigrationShape and the second apply hold to
// the rules in the header.
const MIGRATION_RULES_FROM = 77;
const rulesFrom = String(MIGRATION_RULES_FROM).padStart(3, '0');

// Runs right after each schema file in the same psql session. Inside an open
// transaction now() keeps the time of its BEGIN; in a fresh implicit
// transaction it equals the start of this statement.
const OPEN_TRANSACTION_CHECK = `DO $open$
BEGIN
  IF pg_catalog.now() <> pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'left a transaction open: the file ran BEGIN without a matching COMMIT, and psql would roll it back on exit';
  END IF;
END
$open$;`;

// One line per catalog object: kind, name, and an md5 of its definition (the
// row count itself for "rows"). Two runs of a re-runnable migration give the
// same lines.
const acl = (column) => `CASE WHEN ${column} IS NULL THEN 'default' ELSE array_to_string(ARRAY(SELECT item::text FROM unnest(${column}) item ORDER BY 1), ',') END`;
const FINGERPRINT_SQL = `
WITH ns AS (
  SELECT oid, nspname, nspowner, nspacl FROM pg_namespace
   WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND nspname !~ '^pg_(toast_)?temp_'
),
entries(kind, name, value) AS (
  SELECT 'schema'::text, n.nspname::text, pg_get_userbyid(n.nspowner)::text || ' ' || ${acl('n.nspacl')} FROM ns n
  UNION ALL
  SELECT 'routine', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         pg_get_userbyid(p.proowner) || ' ' || CASE WHEN p.prokind = 'a' THEN 'aggregate' ELSE pg_get_functiondef(p.oid) END || ' ' || ${acl('p.proacl')}
    FROM pg_proc p JOIN ns n ON n.oid = p.pronamespace
  UNION ALL
  SELECT 'relation', n.nspname || '.' || c.relname,
         c.relkind::text || ' ' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity::text || ' force=' || c.relforcerowsecurity::text
         || ' ' || ${acl('c.relacl')} || ' ' || coalesce(array_to_string(c.reloptions, ','), '')
         || ' ' || CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid) ELSE '' END
    FROM pg_class c JOIN ns n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
  UNION ALL
  SELECT 'column', n.nspname || '.' || c.relname || '.' || a.attname,
         a.attnum::text || ' ' || format_type(a.atttypid, a.atttypmod) || ' notnull=' || a.attnotnull::text
         || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ' identity=' || a.attidentity::text
         || ' generated=' || a.attgenerated::text || ' ' || ${acl('a.attacl')}
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN ns n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'c') AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint', n.nspname || '.' || c.relname || '.' || k.conname, pg_get_constraintdef(k.oid)
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN ns n ON n.oid = c.relnamespace
  UNION ALL
  SELECT 'index', n.nspname || '.' || i.relname, pg_get_indexdef(x.indexrelid) || ' valid=' || x.indisvalid::text
    FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN ns n ON n.oid = i.relnamespace
  UNION ALL
  SELECT 'policy', n.nspname || '.' || c.relname || '.' || p.polname,
         p.polcmd::text || ' permissive=' || p.polpermissive::text
         || ' to=' || array_to_string(ARRAY(SELECT CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r) END FROM unnest(p.polroles) r ORDER BY 1), ',')
         || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN ns n ON n.oid = c.relnamespace
  UNION ALL
  SELECT 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN ns n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'event-trigger', e.evtname, e.evtevent::text || ' ' || e.evtfoid::regproc::text || ' ' || e.evtenabled::text || ' ' || coalesce(array_to_string(e.evttags, ','), '')
    FROM pg_event_trigger e
  UNION ALL
  SELECT 'type', n.nspname || '.' || t.typname,
         t.typtype::text || ' ' || pg_get_userbyid(t.typowner) || ' ' || CASE t.typtype
           WHEN 'e' THEN array_to_string(ARRAY(SELECT e.enumlabel::text FROM pg_enum e WHERE e.enumtypid = t.oid ORDER BY e.enumsortorder), ',')
           WHEN 'd' THEN format_type(t.typbasetype, t.typtypmod) || ' notnull=' || t.typnotnull::text || ' default=' || coalesce(t.typdefault, '')
             || ' ' || array_to_string(ARRAY(SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.contypid = t.oid ORDER BY 1), ',')
           ELSE '' END || ' ' || ${acl('t.typacl')}
    FROM pg_type t JOIN ns n ON n.oid = t.typnamespace WHERE t.typtype IN ('e', 'd', 'r', 'm')
  UNION ALL
  SELECT 'comment', coalesce(pg_describe_object(d.classoid, d.objoid, d.objsubid), d.classoid::text || '/' || d.objoid::text || '/' || d.objsubid::text), d.description
    FROM pg_description d WHERE d.objoid >= 16384
  UNION ALL
  SELECT 'default-acl', pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text, ${acl('d.defaclacl')}
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  UNION ALL
  SELECT 'publication', p.pubname, pg_get_userbyid(p.pubowner) || ' all=' || p.puballtables::text || ' ' || p.pubinsert::text || p.pubupdate::text || p.pubdelete::text || p.pubtruncate::text
    FROM pg_publication p
  UNION ALL
  SELECT 'publication-table', t.pubname || ' ' || t.schemaname || '.' || t.tablename, coalesce(array_to_string(t.attnames, ','), '') || ' ' || coalesce(t.rowfilter, '')
    FROM pg_publication_tables t
  UNION ALL
  SELECT 'extension', e.extname::text, e.extversion || ' ' || e.extnamespace::regnamespace::text FROM pg_extension e
  UNION ALL
  SELECT 'cron', 'cron.job', CASE WHEN has_table_privilege(to_regclass('cron.job'), 'SELECT')
    THEN query_to_xml('SELECT jobname, schedule, command, database, username, active FROM cron.job ORDER BY jobname, schedule, command', false, false, '')::text
    ELSE '' END
  UNION ALL
  SELECT 'rows', n.nspname || '.' || c.relname,
         (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'devshark_private') AND c.relkind IN ('r', 'p')
)
SELECT kind || E'\\t' || name || E'\\t' || CASE WHEN kind = 'rows' THEN value ELSE md5(coalesce(value, '')) END
  FROM entries ORDER BY 1;`;

function psql(args) {
  return spawnSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    env: { ...process.env, PGOPTIONS: '--client-min-messages=warning -c plpgsql.check_asserts=on' },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function must(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message} (is psql installed?)`);
  if (result.status !== 0) {
    console.error(`${what} failed:\n${(result.stderr || result.stdout).trim()}`);
    process.exit(1);
  }
  return result.stdout;
}

// Splits SQL into its top-level statements with the comments removed. It reads
// as much of Postgres's lexer as migrations need: '…' and E'…' strings, "…"
// identifiers, $tag$…$tag$ bodies, -- comments and nested /* */ comments.
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  const identifierChar = (ch) => /[A-Za-z0-9_$]/.test(ch ?? '');
  while (i < sql.length) {
    const ch = sql[i];
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      current += ' ';
    } else if (sql.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth += 1; i += 2; } else if (sql.startsWith('*/', i)) { depth -= 1; i += 2; } else i += 1;
      }
      current += ' ';
    } else if (ch === "'" || ch === '"') {
      const backslashes = ch === "'" && /[eE]/.test(sql[i - 1] ?? '') && !identifierChar(sql[i - 2]);
      let j = i + 1;
      while (j < sql.length) {
        if (backslashes && sql[j] === '\\') j += 2;
        else if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) break;
        else j += 1;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '$' && !identifierChar(sql[i - 1]) && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i, i + 65))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 65))[0];
      const close = sql.indexOf(tag, i + tag.length);
      const end = close === -1 ? sql.length : close + tag.length;
      current += sql.slice(i, end);
      i = end;
    } else if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i += 1;
    } else {
      current += ch;
      i += 1;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

// The written shape of a migration from 077 on: one transaction with both
// timeouts, and nothing that ends it early.
function checkMigrationShape(name) {
  const statements = splitStatements(readFileSync(join(schemaDir, name), 'utf8')).map((one) => one.replace(/\s+/g, ' '));
  const problems = [];
  if (!/^BEGIN(?: TRANSACTION| WORK)?$/i.test(statements[0] ?? '')) problems.push('its first statement must be BEGIN;');
  for (const setting of ['lock_timeout', 'statement_timeout']) {
    const set = new RegExp(`^SET LOCAL ${setting} ?(?:=|TO )`, 'i');
    if (!statements.slice(1, 3).some((one) => set.test(one))) problems.push(`SET LOCAL ${setting} must come right after BEGIN (one of the next two statements)`);
  }
  if (!/^COMMIT(?: TRANSACTION| WORK)?$/i.test(statements.at(-1) ?? '')) problems.push('its last statement must be COMMIT;');
  const control = statements.slice(1, -1).find((one) => /^(?:BEGIN|START TRANSACTION|COMMIT|END|ABORT|ROLLBACK(?! TO))\b/i.test(one));
  if (control) problems.push(`it must not end or restart the transaction in the middle (found "${control}")`);
  if (problems.length) {
    console.error(`supabase/${name} breaks the rules for migrations from ${rulesFrom} on (supabase-schema-076.sql shows the shape):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}

function applySchemaFile(name, what) {
  must(psql(['-f', join(schemaDir, name), '-c', OPEN_TRANSACTION_CHECK]), what);
}

function catalogFingerprint(what) {
  const entries = new Map();
  for (const line of must(psql(['-A', '-t', '-c', FINGERPRINT_SQL]), what).split('\n')) {
    if (!line) continue;
    const [kind, name, value] = line.split('\t');
    const key = `${kind} ${name}`;
    entries.set(key, entries.has(key) ? `${entries.get(key)},${value}` : value);
  }
  return entries;
}

function fingerprintChanges(before, after) {
  const changes = [];
  for (const [key, value] of after) {
    if (!before.has(key)) changes.push(`added   ${key}`);
    else if (before.get(key) !== value) changes.push(key.startsWith('rows ') ? `${key}: ${before.get(key)} before, ${value} after` : `changed ${key}`);
  }
  for (const key of before.keys()) if (!after.has(key)) changes.push(`removed ${key}`);
  return changes;
}

// 1. Refuse anything but an empty database.
const tables = must(psql(['-A', '-t', '-c', "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')"]), 'Checking the database');
if (Number(tables.trim()) !== 0) {
  console.error(`test:sql rebuilds the schema from the migrations and needs an empty database; public already has ${tables.trim()} tables. Point DATABASE_URL at a fresh container.`);
  process.exit(2);
}

// 2. The few objects Supabase provides that a bare image may lack.
must(psql(['-f', join(testDir, 'shims.sql')]), 'Applying supabase/tests/shims.sql');

// 3. The base schema, then every numbered migration, discovered and ordered by number.
const numbered = readdirSync(schemaDir)
  .map((name) => ({ name, match: /^supabase-schema-(\d+)\.sql$/.exec(name) }))
  .filter((file) => file.match)
  .map((file) => ({ name: file.name, number: Number(file.match[1]) }))
  .sort((a, b) => a.number - b.number);
const numbers = numbered.map((file) => file.number);
for (let i = 0; i < numbers.length; i += 1) {
  const expected = i + 2;
  if (numbers[i] !== expected) {
    console.error(`Migrations must be numbered 002, 003, … without gaps or duplicates; expected ${String(expected).padStart(3, '0')}, found ${numbered[i].name}.`);
    process.exit(1);
  }
}
const migrations = ['supabase-schema.sql', ...numbered.map((file) => file.name)];
const ruled = numbered.filter((file) => file.number >= MIGRATION_RULES_FROM).map((file) => file.name);
for (const name of migrations) {
  applySchemaFile(name, `Applying supabase/${name}`);
  if (!ruled.includes(name)) continue;
  checkMigrationShape(name);
  const before = catalogFingerprint(`Reading the catalog after supabase/${name}`);
  applySchemaFile(name, `Applying supabase/${name} a second time`);
  const changes = fingerprintChanges(before, catalogFingerprint(`Reading the catalog after the second apply of supabase/${name}`));
  if (changes.length) {
    console.error(`supabase/${name} is not safe to re-run; its second apply changed the catalog or a row count:`);
    for (const change of changes.slice(0, 20)) console.error(`  ${change}`);
    if (changes.length > 20) console.error(`  … and ${changes.length - 20} more`);
    console.error('Guard each statement: IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS before CREATE, ON CONFLICT DO NOTHING.');
    process.exit(1);
  }
}
console.log(`Applied ${migrations.length} schema files (supabase-schema.sql … ${migrations.at(-1)}); re-applied ${ruled.length} from ${rulesFrom} on with no change.`);

// 4. The behaviour tests, each in a transaction that is rolled back.
const knownPath = join(testDir, 'known-failures.txt');
const known = new Map();
if (existsSync(knownPath)) {
  for (const line of readFileSync(knownPath, 'utf8').split('\n')) {
    const text = line.replace(/#.*/, '').trim();
    if (!text) continue;
    const match = /^(\S+\.test\.sql):\s*(.+)$/.exec(text);
    if (!match) {
      console.error(`known-failures.txt: "${text}" is not "<file>.test.sql: <text the failure contains>".`);
      process.exit(1);
    }
    known.set(match[1], match[2]);
  }
}
const tests = readdirSync(testDir).filter((name) => name.endsWith('.test.sql')).sort();
for (const file of known.keys()) {
  if (!tests.includes(file)) {
    console.error(`known-failures.txt names ${file}, which is not a test file in supabase/tests.`);
    process.exit(1);
  }
}

let failed = 0;
let expected = 0;
for (const name of tests) {
  const result = psql(['-c', 'BEGIN', '-f', join(testDir, name), '-c', 'ROLLBACK']);
  if (result.error) throw result.error;
  const passed = result.status === 0;
  const output = (result.stderr || '').trim();
  if (known.has(name)) {
    if (passed) {
      failed += 1;
      console.error(`  FIXED ${name} — it passes now; remove it from supabase/tests/known-failures.txt`);
    } else if (output.includes(known.get(name))) {
      expected += 1;
      console.log(`  XFAIL ${name} — the known bug in known-failures.txt`);
      console.log(indent(output));
    } else {
      failed += 1;
      console.error(`  FAIL  ${name} — not the known failure ("${known.get(name)}")`);
      console.error(indent(output));
    }
  } else if (passed) {
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(indent(output));
  }
}

function indent(text) {
  return text.split('\n').map((line) => `        ${line}`).join('\n');
}

const summary = `${tests.length} SQL test files · ${tests.length - failed - expected} passed · ${expected} known failures · ${failed} failed`;
if (failed) {
  console.error(summary);
  process.exit(1);
}
console.log(summary);
