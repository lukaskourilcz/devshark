// /dev → Triage tab. Reviews the pre-computed question-bank triage (see
// triage/README.md): every scored question with its gate verdict + 1-5 axis
// scores, defaulting to the "cut" candidates so the owner can eyeball each one
// and click Remove (soft-delete via the same admin endpoint as the Questions
// tab). The verdicts are a private admin overlay; the live
// question text and current deleted state come from the admin API.

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHeaderCell,
} from '@astryxdesign/core/Table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import LoadingScreen from '../LoadingScreen';
import ErrorRetry from '../ErrorRetry';
import { AppToast } from '../ui/AppToast';
import { getCategoryLabel, textOnColor } from '../../lib/categories';
import { friendlyError } from '../../lib/api';
import { deleteQuestions, listQuestions, setQuestionDeleted, type AdminQuestion } from '../../lib/devApi';
import { triageVerdictsQuery, GATE_LABEL, type TriageVerdict } from '../../lib/triageApi';
import { useActiveSubject } from '../../lib/subjects';
import { BrandedConfirmDialog, type ConfirmRequest } from '../ui/BrandedConfirmDialog';

interface Row {
  q: AdminQuestion;
  v: TriageVerdict;
}

type DecisionFilter = 'cut' | 'keep' | 'all';
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

// Shared style for the native <select> filter controls (mirrors a small input).
const selectStyle: React.CSSProperties = {
  height: 32,
  padding: '0 8px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'var(--color-background-surface)',
  color: 'var(--color-text-primary)',
  fontSize: '0.875rem',
};

// Mean → colour band for the score badge.
function meanColor(mean: number): string {
  if (mean < 2.5) return '#c62828';
  if (mean < 3.0) return '#ef6c00';
  if (mean < 3.5) return '#f9a825';
  if (mean < 4.0) return '#558b2f';
  return '#1b5e20';
}

const reasonLabel = (r: string): string =>
  GATE_LABEL[r] ?? (r === 'duplicate' ? 'Duplicate' : r.startsWith('relevance') ? 'Low relevance' : r.startsWith('mean') ? 'Low mean' : r);

export default function DevTriage() {
  const activeSubject = useActiveSubject();
  const questionsQuery = useQuery({ queryKey: ['admin', 'questions'], queryFn: ({ signal }) => listQuestions(signal) });
  const triageQuery = useQuery(triageVerdictsQuery);

  const [decision, setDecision] = useState<DecisionFilter>('cut');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [gateFilter, setGateFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [snack, setSnack] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // Ids removed this session — filtered out immediately so the row vanishes on
  // click (the server soft-delete also makes them gone on any later reload).
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const loading = questionsQuery.isPending || triageQuery.isPending;
  const error = questionsQuery.error
    ? friendlyError(questionsQuery.error)
    : triageQuery.error
      ? friendlyError(triageQuery.error)
      : null;
  const reload = () => {
    void questionsQuery.refetch();
    void triageQuery.refetch();
  };
  // The Question bank tab reads the same cached list: after a delete here it
  // is out of date, and for a minute that tab still listed the deleted
  // questions as live.
  const queryClient = useQueryClient();
  const markBankChanged = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'questions'] });

  // Join the live questions with their triage verdict (by id). Custom questions
  // added after scoring simply have no verdict and are skipped.
  const rows: Row[] = useMemo(() => {
    const verdicts = triageQuery.data?.verdicts ?? {};
    const out: Row[] = [];
    const subjectCategories = new Set<string>(activeSubject.categories);
    for (const q of questionsQuery.data?.questions ?? []) {
      if (!subjectCategories.has(q.category)) continue;
      const v = verdicts[q.id];
      if (v) out.push({ q, v });
    }
    return out;
  }, [questionsQuery.data, triageQuery.data, activeSubject]);

  const categories = (questionsQuery.data?.categories ?? []).filter((category) => activeSubject.categories.includes(category as never));

  useEffect(() => {
    setCategoryFilter('all');
    setPage(0);
  }, [activeSubject.id]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter(({ q, v }) => {
        // Gone the moment it's removed (and on reload, via q.deleted).
        if (q.deleted || removed.has(q.id)) return false;
        if (decision !== 'all' && v.dec !== decision) return false;
        if (categoryFilter !== 'all' && q.category !== categoryFilter) return false;
        if (gateFilter !== 'all') {
          if (gateFilter === 'duplicate' ? !v.dup : !v.greasons.includes(gateFilter)) return false;
        }
        if (term) {
          const hit = q.question.toLowerCase().includes(term) || q.id.toLowerCase().includes(term);
          if (!hit) return false;
        }
        return true;
      })
      // worst first
      .sort((a, b) => a.v.mean - b.v.mean);
  }, [rows, decision, categoryFilter, gateFilter, search, removed]);

  const stats = useMemo(() => {
    let keep = 0, cut = 0, gone = 0;
    for (const { q, v } of rows) {
      if (v.dec === 'keep') keep++; else cut++;
      if (q.deleted || removed.has(q.id)) gone++;
    }
    return { total: rows.length, keep, cut, gone };
  }, [rows, removed]);

  const pageStart = Math.min(page * rowsPerPage, Math.max(0, (Math.ceil(filtered.length / rowsPerPage) - 1) * rowsPerPage));
  const pageRows = filtered.slice(pageStart, pageStart + rowsPerPage);
  const currentPage = Math.floor(pageStart / rowsPerPage);
  const rangeFrom = filtered.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + rowsPerPage, filtered.length);

  // The confirmed row is filtered out instantly (optimistic) and the question
  // is deleted on the server so it is gone everywhere on reload too. On a
  // server error the row is restored locally.
  const removeConfirmed = (r: Row) => {
    setRemoved((prev) => new Set(prev).add(r.q.id));
    setQuestionDeleted(r.q.id, true)
      .then(() => { setSnack(`Deleted ${r.q.id}`); markBankChanged(); })
      .catch((err) => {
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(r.q.id);
          return next;
        });
        setSnack(friendlyError(err));
      });
  };

  const requestRemove = (r: Row) => {
    setConfirm({
      title: `Delete ${r.q.id}?`,
      description: 'This permanently removes the question from the bank and cannot be undone.',
      actionLabel: 'Delete permanently',
      onConfirm: () => removeConfirmed(r),
    });
  };

  // Bulk-delete every row matching the current filters (kept behind a confirm
  // since it can be hundreds at once). Each is gone permanently.
  const removeAllShown = async () => {
    if (filtered.length === 0) return;
    setConfirm({ title: `Delete ${filtered.length} shown questions?`, description: 'This permanently removes every question matching the current filters and cannot be undone.', actionLabel: 'Delete permanently', onConfirm: () => removeAllShownConfirmed() });
  };

  const removeAllShownConfirmed = async () => {
    setBusy(true);
    const ids = filtered.map((r) => r.q.id);
    setRemoved((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; });
    let n = 0;
    try {
      await deleteQuestions(ids, () => { n++; });
      setSnack(`Deleted ${n} question${n === 1 ? '' : 's'}`);
    } catch (err) {
      // The rows from the one that failed on are still in the bank: show them
      // again, or they looked deleted until the next reload.
      const kept = ids.slice(n);
      setRemoved((prev) => { const next = new Set(prev); kept.forEach((id) => next.delete(id)); return next; });
      setSnack(`${friendlyError(err)} (deleted ${n} before stopping)`);
    } finally {
      if (n > 0) markBankChanged();
      setBusy(false);
    }
  };

  if (loading) return <LoadingScreen label="Loading triage…" />;
  if (error) return <ErrorRetry message={error} onRetry={reload} />;

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
        Pre-computed triage of the question bank — gates (binary cut) kept separate from the 1–5 scores
        (R relevance · D discrimination · F difficulty-fit · C clarity). Default rule:{' '}
        <code>{triageQuery.data?.meta.keepRule}</code>. Delete permanently removes a question after confirmation.
      </p>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Badge variant="neutral" label={`${stats.total} scored`} />
        <Badge variant="success" label={`${stats.keep} keep`} />
        <Badge variant="error" label={`${stats.cut} cut`} />
        <Badge variant="error" label={`${stats.gone} deleted`} />
        <Badge variant="neutral" label={`${filtered.length} shown`} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <TextInput
            size="sm"
            label="Search"
            isLabelHidden
            width="100%"
            placeholder="Search question or id…"
            value={search}
            onChange={(value) => { setSearch(value); setPage(0); }}
          />
        </div>
        <select aria-label="Decision" value={decision} style={{ ...selectStyle, minWidth: 130 }}
          onChange={(e) => { setDecision(e.target.value as DecisionFilter); setPage(0); }}>
          <option value="cut">Cut candidates</option>
          <option value="keep">Keep</option>
          <option value="all">All</option>
        </select>
        <select aria-label="Reason" value={gateFilter} style={{ ...selectStyle, minWidth: 150 }}
          onChange={(e) => { setGateFilter(e.target.value); setPage(0); }}>
          <option value="all">All reasons</option>
          <option value="trivial_recall">Trivial recall</option>
          <option value="ambiguous">Ambiguous</option>
          <option value="wrong_or_outdated">Wrong / outdated</option>
          <option value="duplicate">Duplicate</option>
        </select>
        <select aria-label="Category" value={categoryFilter} style={{ ...selectStyle, minWidth: 150 }}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{getCategoryLabel(c)}</option>)}
        </select>
      </div>

      {/* Bulk action */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16, padding: 8, border: '1px dashed var(--color-border)', borderRadius: 8 }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Bulk:</span>
        <Button size="sm" variant="destructive" isDisabled={busy || filtered.length === 0} onClick={removeAllShown}
          label={`Delete all ${filtered.length} shown`} />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
          Applies to the current filter. Permanent — confirmed once.
        </span>
      </div>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflowX: 'auto' }}>
        <Table density="compact" dividers="rows" hasHover verticalAlign="top">
          <TableHeader>
            <TableRow isHeaderRow>
              <TableHeaderCell style={{ width: '52%' }}>Question &amp; answers</TableHeaderCell>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell style={{ textAlign: 'center' }}>Scores</TableHeaderCell>
              <TableHeaderCell>Verdict</TableHeaderCell>
              <TableHeaderCell style={{ textAlign: 'right' }}>Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map(({ q, v }) => (
              <TableRow key={q.id}>
                <TableCell style={{ verticalAlign: 'top' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--color-text-primary)' }}>
                    {q.question}
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {q.options.map((opt, i) => (
                      <div key={i} style={{
                        fontSize: '0.75rem',
                        color: i === q.correctAnswer ? '#2e7d32' : 'var(--color-text-secondary)',
                        fontWeight: i === q.correctAnswer ? 700 : 400,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {i === q.correctAnswer ? '✓' : '○'} {opt}
                      </div>
                    ))}
                  </div>
                  {v.note && (
                    <div style={{ fontSize: '0.75rem', marginTop: 4, fontStyle: 'italic', color: 'var(--color-text-secondary)' }}>
                      “{v.note}”
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-disabled)', marginTop: 2 }}>{q.id} · diff {v.diff}</div>
                </TableCell>

                <TableCell><span style={{ fontSize: '0.75rem', color: 'var(--color-text-primary)' }}>{getCategoryLabel(q.category)}</span></TableCell>

                <TableCell style={{ textAlign: 'center' }}>
                  <span title="Mean of the 4 axes" style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 34, height: 24, padding: '0 4px', borderRadius: 8, fontWeight: 700, fontSize: '0.8rem',
                    color: textOnColor(meanColor(v.mean)), backgroundColor: meanColor(v.mean),
                  }}>
                    {v.mean.toFixed(2)}
                  </span>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: 2, fontFamily: 'monospace' }}>
                    R{v.rel} D{v.disc} F{v.fit} C{v.clar}
                  </div>
                </TableCell>

                <TableCell>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    <Badge variant={v.dec === 'cut' ? 'error' : 'success'} label={v.dec === 'cut' ? 'CUT' : 'KEEP'} />
                    {v.reasons.map((r) => (
                      <Badge key={r} variant={v.greasons.includes(r) ? 'error' : 'neutral'} label={reasonLabel(r)} />
                    ))}
                  </div>
                </TableCell>

                <TableCell style={{ textAlign: 'right' }}>
                  <Button size="sm" variant="destructive" isDisabled={busy} onClick={() => requestRemove({ q, v })} label="Delete" />
                </TableCell>
              </TableRow>
            ))}
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', textAlign: 'center', padding: '32px 0' }}>
                    No questions match these filters.
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16, padding: '8px 4px', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          Rows per page:
          <select
            value={rowsPerPage}
            style={selectStyle}
            onChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          >
            {ROWS_PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          {rangeFrom}–{rangeTo} of {filtered.length}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button size="sm" variant="ghost" label="Previous page" isIconOnly icon={<span aria-hidden>‹</span>}
            isDisabled={pageStart === 0} onClick={() => setPage(currentPage - 1)} />
          <Button size="sm" variant="ghost" label="Next page" isIconOnly icon={<span aria-hidden>›</span>}
            isDisabled={pageStart + rowsPerPage >= filtered.length} onClick={() => setPage(currentPage + 1)} />
        </div>
      </div>

      <AppToast
        open={!!snack}
        onClose={() => setSnack(null)}
        message={snack ?? ''}
        severity="info"
        autoHideDuration={2500}
      />
      <BrandedConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
