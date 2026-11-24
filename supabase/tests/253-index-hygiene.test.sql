-- No index in public repeats another one. Every index costs a write on each
-- insert and on each update of a key column, and a plain index whose key
-- columns lead another index on the same table answers no query that index
-- cannot. Supabase's duplicate_index lint compares whole definitions, so it
-- misses a plain index that repeats a UNIQUE one or is a prefix of a longer
-- one.
--
-- An index counts as redundant when it is valid, not unique and backs no
-- constraint, has no INCLUDE columns, and another valid index on the same
-- table, with the same access method and predicate, starts with the same key
-- columns or expressions, operator classes, collations and sort options. A
-- longer index covers a prefix only for btree; for another access method the
-- keys must match exactly. Of two identical plain indexes the newer is named.

CREATE FUNCTION pg_temp.redundant_indexes()
RETURNS TEXT[] LANGUAGE sql STABLE AS $$
  WITH idx AS (
    SELECT x.indexrelid AS oid, x.indrelid AS tbl, i.relname::TEXT AS name, i.relam AS am,
           x.indisunique, x.indisprimary, x.indisexclusion, x.indnatts, x.indnkeyatts,
           x.indkey::INT2[] AS keys, x.indclass::OID[] AS classes, x.indcollation::OID[] AS collations,
           x.indoption::INT2[] AS options,
           pg_catalog.pg_get_expr(x.indexprs, x.indrelid) AS exprs,
           pg_catalog.pg_get_expr(x.indpred, x.indrelid) AS pred
      FROM pg_catalog.pg_index x
      JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
     WHERE i.relnamespace = 'public'::REGNAMESPACE AND x.indisvalid
  ),
  pair AS (
    SELECT a.name AS redundant, b.name AS covering
      FROM idx a
      JOIN idx b ON b.tbl = a.tbl AND b.oid <> a.oid AND b.am = a.am
     WHERE NOT a.indisunique AND NOT a.indisprimary AND NOT a.indisexclusion
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conindid = a.oid)
       AND a.indnatts = a.indnkeyatts
       AND (b.indnkeyatts = a.indnkeyatts
            OR (b.indnkeyatts > a.indnkeyatts
                AND a.am = (SELECT m.oid FROM pg_catalog.pg_am m WHERE m.amname = 'btree')))
       AND b.keys[0:a.indnkeyatts - 1] = a.keys[0:a.indnkeyatts - 1]
       AND b.classes[0:a.indnkeyatts - 1] = a.classes[0:a.indnkeyatts - 1]
       AND b.collations[0:a.indnkeyatts - 1] = a.collations[0:a.indnkeyatts - 1]
       AND b.options[0:a.indnkeyatts - 1] = a.options[0:a.indnkeyatts - 1]
       AND b.exprs IS NOT DISTINCT FROM a.exprs
       AND b.pred IS NOT DISTINCT FROM a.pred
       -- Two identical plain indexes: name only the newer one.
       AND (b.indisunique OR b.indisprimary OR b.indnkeyatts > a.indnkeyatts OR b.oid < a.oid)
  )
  SELECT coalesce(array_agg(format('%s (covered by %s)', p.redundant, p.covering) ORDER BY p.redundant, p.covering), '{}')
    FROM pair p
$$;

-- Self-check: a prefix of a primary key, a duplicate of a UNIQUE index and two
-- identical plain indexes are reported; an index on the second column, a
-- partial index and a descending one are not.
CREATE TABLE public.f8_probe_indexes (a INTEGER, b INTEGER, c TEXT, PRIMARY KEY (a, b), UNIQUE (c));
CREATE INDEX f8_probe_a_idx ON public.f8_probe_indexes (a);
CREATE INDEX f8_probe_c_idx ON public.f8_probe_indexes (c);
CREATE INDEX f8_probe_b_idx ON public.f8_probe_indexes (b);
CREATE INDEX f8_probe_b_again_idx ON public.f8_probe_indexes (b);
CREATE INDEX f8_probe_a_partial_idx ON public.f8_probe_indexes (a) WHERE c IS NOT NULL;
CREATE INDEX f8_probe_a_desc_idx ON public.f8_probe_indexes (a DESC);

DO $$
DECLARE
  v_probe TEXT[] := ARRAY(
    SELECT f.line FROM unnest(pg_temp.redundant_indexes()) AS f(line) WHERE f.line LIKE 'f8\_probe\_%'
  );
BEGIN
  ASSERT v_probe = ARRAY[
    'f8_probe_a_idx (covered by f8_probe_indexes_pkey)',
    'f8_probe_b_again_idx (covered by f8_probe_b_idx)',
    'f8_probe_c_idx (covered by f8_probe_indexes_c_key)'
  ], format('self-check: the probe indexes reported were %s', v_probe);
END;
$$;

DROP TABLE public.f8_probe_indexes;

DO $$
DECLARE
  v_found TEXT[] := pg_temp.redundant_indexes();
BEGIN
  ASSERT cardinality(v_found) = 0, format('redundant indexes: %s', array_to_string(v_found, '; '));
END;
$$;
