import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { AdminDisclosure } from '../admin/AdminDisclosure';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableHeaderCell } from '@astryxdesign/core/Table';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { useQuery } from '@tanstack/react-query';
import LoadingScreen from '../LoadingScreen';
import ErrorRetry from '../ErrorRetry';
import { AppToast } from '../ui/AppToast';
import { getCategoryLabel, textOnColor } from '../../lib/categories';
import { friendlyError } from '../../lib/api';
import { importanceBand, IMPORTANCE_BAND_LABEL, type ImportanceBand } from '../../lib/importance';
import {
  listQuestions,
  setQuestionDeleted,
  deleteQuestions,
  resetQuestion,
  bulkHideByImportance,
  type AdminQuestion,
} from '../../lib/devApi';
import QuestionEditor from './QuestionEditor';
import { useActiveSubject } from '../../lib/subjects';
import { BrandedConfirmDialog, type ConfirmRequest } from '../ui/BrandedConfirmDialog';

// First line of a question, with any code block stripped, for the list summary.
const summarize = (text: string): string => {
  const beforeCode = text.split('```')[0].replace(/\s+/g, ' ').trim();
  return beforeCode || text.replace(/\s+/g, ' ').trim();
};

// Color for the importance score chip, by band.
const SCORE_COLOR: Record<ImportanceBand, string> = {
  filler: '#c62828',
  low: '#ef6c00',
  medium: '#f9a825',
  high: '#2e7d32',
  essential: '#1b5e20',
};

type SortKey = 'importance' | 'difficulty' | 'category' | 'question';
type SortDir = 'asc' | 'desc';
// 'all' | exact score | 'filler' (the ≤3 band the owner cares about most).
type ImportanceFilter = 'all' | 'filler' | number;

const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

const captionStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-text-secondary)',
};

const selectStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 'var(--radius-element)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-background-surface)',
  color: 'var(--color-text-primary)',
  padding: '0 12px',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
};

// A native <select> dressed to sit alongside the Astryx inputs — replaces
// MUI's <TextField select>. Renders a Field-style label + optional helper.
function SelectField({
  label,
  value,
  onChange,
  style,
  children,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      {label && <label htmlFor={id} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{label}</label>}
      <select id={id} aria-label={label || 'Filter'} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {children}
      </select>
    </div>
  );
}

// Sortable column header — replaces MUI's <TableSortLabel>.
function SortLabel({
  active,
  direction,
  onClick,
  title,
  children,
}: {
  active: boolean;
  direction: SortDir;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        font: 'inherit',
        fontWeight: active ? 700 : 600,
        color: 'var(--color-text-primary)',
      }}
    >
      {children}
      <span aria-hidden style={{ opacity: active ? 1 : 0.25, fontSize: '0.7em' }}>
        {direction === 'asc' ? '▲' : '▼'}
      </span>
    </button>
  );
}

// Compact, subtle text button for row actions — mirrors MUI's small text
// <Button>s (brand-accent by default, red for destructive actions).
function ActionButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '0.8rem',
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 'var(--radius-inner)',
        color: danger ? '#dc2626' : 'var(--brand-accent)',
      }}
    >
      {label}
    </button>
  );
}

// Tiny outlined pill for inline meta (source tag, tags, flags) — mirrors the
// dense outlined MUI <Chip>s used inside table cells.
function Pill({
  label,
  color,
  title,
}: {
  label: ReactNode;
  color?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 6px',
        fontSize: '0.65rem',
        lineHeight: 1,
        borderRadius: 999,
        border: '1px solid',
        borderColor: color ?? 'var(--color-border)',
        color: color ?? 'var(--color-text-secondary)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

/** What the content audit says about this exact wording. `not-in-scope` is an
 * item the audit does not cover; everything else is an audit verdict, and only
 * `reviewed` is served. An edit turns a reviewed item into
 * `superseded` until a review of the new wording is recorded in the ledger. */
const REVIEW_COLOR: Record<AdminQuestion['review']['reason'], string> = {
  reviewed: '#15803d',
  'not-in-scope': '#6b7280',
  unreviewed: '#b45309',
  superseded: '#b45309',
  retired: '#dc2626',
  quarantined: '#dc2626',
  'failed-gate': '#dc2626',
  'invalid-record': '#dc2626',
};

function ReviewCell({ review }: { review: AdminQuestion['review'] }) {
  if (review.reason === 'not-in-scope') return <span style={{ fontSize: '0.75rem', color: 'var(--color-text-disabled)' }}>—</span>;
  const scores = review.relevance !== undefined && review.quality !== undefined ? ` · R ${review.relevance}/10 · Q ${review.quality}/5` : '';
  const title = [
    review.active ? 'Served: this exact wording has a current passing review.' : `Not served: ${review.reason}.`,
    review.decision ? `Decision: ${review.decision}${review.retireReason ? ` (${review.retireReason})` : ''}.` : 'No decision on record.',
    review.reviewedAt ? `Reviewed ${review.reviewedAt}, revision ${review.revision ?? 1}.` : '',
  ].filter(Boolean).join(' ');
  return (
    <span title={title} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <Pill label={review.reason} color={REVIEW_COLOR[review.reason]} />
      {scores && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>{scores.replace(/^ · /, '')}</span>}
    </span>
  );
}

const SOURCE_PILL_COLOR: Record<AdminQuestion['source'], string> = {
  base: 'var(--color-border)',
  edited: '#f5a623',
  custom: '#16a34a',
};

export default function DevQuestions() {
  const activeSubject = useActiveSubject();
  const { data, isPending: loading, error: queryError, refetch } = useQuery({
    queryKey: ['admin', 'questions'],
    queryFn: listQuestions,
  });
  const subjectCategories = useMemo(() => new Set<string>(activeSubject.categories), [activeSubject]);
  const questions = useMemo(
    () => (data?.questions ?? []).filter((question) => subjectCategories.has(question.category)),
    [data, subjectCategories],
  );
  const categories = useMemo(
    () => (data?.categories ?? []).filter((category) => subjectCategories.has(category)),
    [data, subjectCategories],
  );
  const reportCounts = data?.reportCounts ?? {};
  const error = queryError ? friendlyError(queryError) : null;
  const reload = () => void refetch();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('importance');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [bulkThreshold, setBulkThreshold] = useState(3);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminQuestion | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    setCategoryFilter('all');
    setSelected(new Set());
    setPage(0);
  }, [activeSubject.id]);

  // A question deleted any way (its row, the filler delete, Quality triage)
  // leaves the selection when the bank is read again, so 'Delete selected (n)'
  // never counts or resends one that is already gone.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(questions.filter((q) => !q.deleted).map((q) => q.id));
      const kept = [...prev].filter((id) => live.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [questions]);

  const stats = useMemo(() => {
    let edited = 0;
    let custom = 0;
    let deleted = 0;
    let filler = 0;
    for (const q of questions) {
      if (q.deleted) deleted += 1;
      if (q.source === 'edited') edited += 1;
      if (q.source === 'custom') custom += 1;
      if (q.importance <= 3) filler += 1;
    }
    return { total: questions.length, edited, custom, deleted, filler };
  }, [questions]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return questions.filter((q) => {
      // Deleted questions are gone for good — never list them.
      if (q.deleted) return false;
      if (categoryFilter !== 'all' && q.category !== categoryFilter) return false;
      if (importanceFilter === 'filler' && q.importance > 3) return false;
      if (typeof importanceFilter === 'number' && q.importance !== importanceFilter) return false;
      if (term) {
        const hit =
          q.question.toLowerCase().includes(term) ||
          q.id.toLowerCase().includes(term) ||
          q.tags.some((t) => t.toLowerCase().includes(term));
        if (!hit) return false;
      }
      return true;
    });
  }, [questions, search, categoryFilter, importanceFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a: AdminQuestion, b: AdminQuestion): number => {
      switch (sortBy) {
        case 'importance':
          return (a.importance - b.importance) || (a.difficulty - b.difficulty);
        case 'difficulty':
          return (a.difficulty - b.difficulty) || (a.importance - b.importance);
        case 'category':
          return a.category.localeCompare(b.category);
        case 'question':
          return summarize(a.question).localeCompare(summarize(b.question));
      }
    };
    return [...filtered].sort((a, b) => cmp(a, b) * dir);
  }, [filtered, sortBy, sortDir]);

  // Keep the current page in range as filters change.
  const pageStart = Math.min(page * rowsPerPage, Math.max(0, (Math.ceil(sorted.length / rowsPerPage) - 1) * rowsPerPage));
  const pageRows = sorted.slice(pageStart, pageStart + rowsPerPage);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      // Scores default to high→low; text columns to A→Z.
      setSortDir(key === 'importance' || key === 'difficulty' ? 'desc' : 'asc');
    }
    setPage(0);
  };

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (q: AdminQuestion) => {
    setEditing(q);
    setEditorOpen(true);
  };

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      setSnack(label);
      reload();
    } catch (err) {
      setSnack(friendlyError(err));
    }
  };

  const handleDelete = (q: AdminQuestion) => {
    setConfirm({ title: 'Delete question?', description: 'This permanently removes the question from the bank and cannot be undone.', actionLabel: 'Delete permanently', onConfirm: () => runAction('Question deleted', () => setQuestionDeleted(q.id, true)) });
  };
  const handleReset = (q: AdminQuestion) => {
    setConfirm({ title: 'Revert question?', description: 'Your edits will be discarded and the original question restored.', actionLabel: 'Revert', destructive: false, onConfirm: () => runAction('Reverted to original', () => resetQuestion(q.id)) });
  };

  // How many questions the bulk action would delete: the server takes only the
  // served, non-custom ones (lib/questions-store.ts bulkHideByImportance reads
  // the eligible set), so an unreviewed or retired question is not counted.
  const bulkHideCount = useMemo(
    () => questions.filter((q) => !q.deleted && q.review.active && q.source !== 'custom' && q.importance <= bulkThreshold).length,
    [questions, bulkThreshold],
  );
  const handleBulkHide = async () => {
    if (bulkHideCount === 0) {
      setSnack(`No visible questions score ≤ ${bulkThreshold}`);
      return;
    }
    setConfirm({
      title: `Delete ${bulkHideCount} questions?`,
      description: `Every question scoring ${bulkThreshold} or lower will be permanently removed. Learning paths will re-level automatically.`,
      actionLabel: 'Delete permanently',
      onConfirm: async () => {
        try { const r = await bulkHideByImportance(bulkThreshold); setSnack(`Deleted ${r.hidden} question${r.hidden === 1 ? '' : 's'}`); reload(); }
        catch (err) { setSnack(friendlyError(err)); }
      },
    });
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Select-all targets the rows currently visible on this page.
  const pageIds = pageRows.map((q) => q.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = pageIds.some((id) => selected.has(id));
  const toggleSelectAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  // Mass-delete: hide (or, for custom questions, permanently delete) every
  // selected question. There's no bulk-by-id endpoint, so fan out one call each.
  const handleDeleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setConfirm({ title: `Delete ${ids.length} selected question${ids.length === 1 ? '' : 's'}?`, description: 'This permanently removes the selected questions and cannot be undone.', actionLabel: 'Delete permanently', onConfirm: async () => {
    let n = 0;
    try {
      await deleteQuestions(ids, () => { n += 1; });
      setSnack(`Removed ${n} question${n === 1 ? '' : 's'}`);
    } catch (err) {
      setSnack(`${friendlyError(err)} (removed ${n} of ${ids.length} before stopping)`);
    } finally {
      // Those deleted before a failure are gone too: unselect them and
      // re-read the bank, or they stayed listed and selected as if kept.
      if (n > 0) {
        const gone = new Set(ids.slice(0, n));
        setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
        reload();
      }
    }
    }});
  };

  if (loading) return <LoadingScreen label="Loading questions…" />;
  if (error) return <ErrorRetry message={error} onRetry={reload} />;

  const currentPage = pageStart / rowsPerPage;
  const rangeFrom = sorted.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + rowsPerPage, sorted.length);
  const atLastPage = pageStart + rowsPerPage >= sorted.length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <TextInput
          label="Search questions"
          isLabelHidden
          placeholder="Search question, tag or id…"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          size="sm"
          style={{ flex: 1, minWidth: 200 }}
        />
        <SelectField
          label="Category"
          value={categoryFilter}
          onChange={(v) => {
            setCategoryFilter(v);
            setPage(0);
          }}
          style={{ minWidth: 150 }}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {getCategoryLabel(c)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Score"
          value={String(importanceFilter)}
          onChange={(v) => {
            setImportanceFilter(v === 'all' || v === 'filler' ? v : Number(v));
            setPage(0);
          }}
          style={{ minWidth: 150 }}
        >
          <option value="all">All scores</option>
          <option value="filler">Fillers (1–3)</option>
          {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={String(n)}>
              Score = {n}
            </option>
          ))}
        </SelectField>
        <Button variant="primary" label="+ New question" onClick={openNew} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Badge variant="neutral" label={`${stats.total} total`} />
        <Badge variant="warning" label={`${stats.edited} edited`} />
        <Badge variant="success" label={`${stats.custom} custom`} />
        <Badge variant="error" label={`${stats.filler} filler (≤3)`} />
        <Badge variant="neutral" label={`${filtered.length} shown`} />
      </div>

      {/* A destructive bulk action is never the first thing on the page (admin UX review, 12 November 2026). */}
      <div style={{ marginBottom: 16 }}>
        <AdminDisclosure summary={`Bulk cleanup (${stats.filler} filler)`}>
          <p style={{ ...captionStyle, margin: 0 }}>Permanently removes every question at or below the score; learning paths re-level automatically.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <SelectField
          label="Hide score ≤"
          value={String(bulkThreshold)}
          onChange={(v) => setBulkThreshold(Number(v))}
          style={{ minWidth: 110 }}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </SelectField>
        <Button
          variant="destructive"
          size="sm"
          label={`Delete ${bulkHideCount} filler${bulkHideCount === 1 ? '' : 's'}`}
          onClick={handleBulkHide}
        />
          </div>
        </AdminDisclosure>
      </div>

      {selected.size > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 16,
            padding: 8,
            borderRadius: 'var(--radius-element)',
            backgroundColor: 'rgba(198,40,40,0.06)',
            border: '1px solid #f4b4b4',
          }}
        >
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {selected.size} selected
          </span>
          <Button variant="destructive" size="sm" label={`Delete selected (${selected.size})`} onClick={handleDeleteSelected} />
          <Button variant="ghost" size="sm" label="Clear" onClick={() => setSelected(new Set())} />
        </div>
      )}

      <div
        style={{
          width: '100%',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-container)',
          overflowX: 'auto',
          background: 'var(--color-background-surface)',
        }}
      >
        <Table density="compact" dividers="rows" hasHover verticalAlign="top">
          <TableHeader>
            <TableRow isHeaderRow>
              <TableHeaderCell>
                <CheckboxInput
                  label="Select all questions on this page"
                  isLabelHidden
                  size="sm"
                  value={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                  onChange={toggleSelectAllOnPage}
                />
              </TableHeaderCell>
              <TableHeaderCell style={{ width: '55%' }}>
                <SortLabel active={sortBy === 'question'} direction={sortBy === 'question' ? sortDir : 'asc'} onClick={() => toggleSort('question')}>
                  Question, answers &amp; info
                </SortLabel>
              </TableHeaderCell>
              <TableHeaderCell>
                <SortLabel active={sortBy === 'category'} direction={sortBy === 'category' ? sortDir : 'asc'} onClick={() => toggleSort('category')}>
                  Category
                </SortLabel>
              </TableHeaderCell>
              <TableHeaderCell style={{ textAlign: 'center' }}>
                <SortLabel active={sortBy === 'difficulty'} direction={sortBy === 'difficulty' ? sortDir : 'asc'} onClick={() => toggleSort('difficulty')}>
                  Diff
                </SortLabel>
              </TableHeaderCell>
              <TableHeaderCell style={{ textAlign: 'center' }}>
                <SortLabel
                  active={sortBy === 'importance'}
                  direction={sortBy === 'importance' ? sortDir : 'desc'}
                  onClick={() => toggleSort('importance')}
                  title="Importance for a learner (1–10) — hand-judged per question, editable in the editor"
                >
                  Score
                </SortLabel>
              </TableHeaderCell>
              <TableHeaderCell style={{ textAlign: 'center' }}>Flags</TableHeaderCell>
              <TableHeaderCell style={{ textAlign: 'center' }}>
                <span title="Content-audit eligibility: whether this exact wording is served, and the review on record">Review</span>
              </TableHeaderCell>
              <TableHeaderCell style={{ textAlign: 'right' }}>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((q) => (
              <TableRow key={q.id} style={{ opacity: q.deleted ? 0.5 : 1, backgroundColor: selected.has(q.id) ? 'var(--color-background-muted)' : undefined }}>
                <TableCell>
                  <CheckboxInput
                    label={`Select question ${q.id}`}
                    isLabelHidden
                    size="sm"
                    value={selected.has(q.id)}
                    onChange={() => toggleSelected(q.id)}
                  />
                </TableCell>
                <TableCell>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--color-text-primary)' }}>
                    {q.question}
                  </div>

                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {q.options.map((opt, i) => {
                      const correct = i === q.correctAnswer;
                      return (
                        <div
                          key={i}
                          style={{
                            fontSize: '0.75rem',
                            color: correct ? '#1b5e20' : 'var(--color-text-secondary)',
                            fontWeight: correct ? 700 : 400,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {correct ? '✓' : '○'} {opt}
                        </div>
                      );
                    })}
                  </div>

                  {q.introduction && (
                    <div style={{ fontSize: '0.75rem', marginTop: 6, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      <strong>Info:</strong> {q.introduction}
                    </div>
                  )}
                  {q.explanation && (
                    <div style={{ fontSize: '0.75rem', marginTop: 4, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      <strong>Hint / explanation:</strong> {q.explanation}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                    {q.source !== 'base' && <Pill label={q.source} color={SOURCE_PILL_COLOR[q.source]} />}
                    {q.tags.slice(0, 4).map((tag) => (
                      <Pill key={tag} label={tag} />
                    ))}
                    <span style={captionStyle}>{q.id}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-primary)' }}>{getCategoryLabel(q.category)}</span>
                </TableCell>
                <TableCell style={{ textAlign: 'center' }}>{q.difficulty}</TableCell>
                <TableCell style={{ textAlign: 'center' }}>
                  <span
                    title={IMPORTANCE_BAND_LABEL[importanceBand(q.importance)]}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 26,
                      height: 22,
                      padding: '0 4px',
                      borderRadius: 'var(--radius-inner)',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      color: textOnColor(SCORE_COLOR[importanceBand(q.importance)]),
                      backgroundColor: SCORE_COLOR[importanceBand(q.importance)],
                    }}
                  >
                    {q.importance}
                  </span>
                </TableCell>
                <TableCell style={{ textAlign: 'center' }}>
                  {reportCounts[q.id] ? (
                    <Pill
                      label={`${reportCounts[q.id]} flagged`}
                      color="#dc2626"
                      title={`${reportCounts[q.id]} report(s) — see the Flags tab`}
                    />
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-disabled)' }}>—</span>
                  )}
                </TableCell>
                <TableCell style={{ textAlign: 'center' }}>
                  <ReviewCell review={q.review} />
                </TableCell>
                <TableCell style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 2 }}>
                    <ActionButton label="Edit" onClick={() => openEdit(q)} />
                    <ActionButton label="Delete" danger onClick={() => handleDelete(q)} />
                    {q.source === 'edited' && <ActionButton label="Revert" onClick={() => handleReset(q)} />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <div style={{ ...captionStyle, textAlign: 'center', padding: '32px 0' }}>
                    No questions match these filters.
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 20,
          padding: '8px 4px',
          fontSize: '0.8rem',
          color: 'var(--color-text-secondary)',
        }}
      >
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Rows per page:
          <select
            value={String(rowsPerPage)}
            onChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            style={{ ...selectStyle, height: 32 }}
          >
            {ROWS_PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span>
          {rangeFrom}–{rangeTo} of {sorted.length}
        </span>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <Button
            variant="ghost"
            size="sm"
            label="‹"
            onClick={() => setPage(currentPage - 1)}
            isDisabled={currentPage <= 0}
          />
          <Button
            variant="ghost"
            size="sm"
            label="›"
            onClick={() => setPage(currentPage + 1)}
            isDisabled={atLastPage}
          />
        </div>
      </div>

      <QuestionEditor
        open={editorOpen}
        initial={editing}
        categories={categories}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setSnack(editing ? 'Question saved' : 'Question created');
          reload();
        }}
      />

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
