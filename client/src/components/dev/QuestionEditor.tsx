import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Banner } from '@astryxdesign/core/Banner';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { getCategoryLabel } from '../../lib/categories';
import { friendlyError } from '../../lib/api';
import { saveQuestion, type AdminQuestion, type QuestionPayload } from '../../lib/devApi';
import { BrandedConfirmDialog, type ConfirmRequest } from '../ui/BrandedConfirmDialog';

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;
const DIFFICULTIES = [1, 2, 3, 4, 5];
const IMPORTANCE_LEVELS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

interface Props {
  open: boolean;
  /** The question being edited, or null to create a new one. */
  initial: AdminQuestion | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  introduction: string;
  category: string;
  difficulty: number;
  importance: number;
  tags: string;
}

const blankForm = (categories: string[]): FormState => ({
  question: '',
  options: ['', ''],
  correctIndex: 0,
  explanation: '',
  introduction: '',
  category: categories[0] ?? 'javascript',
  difficulty: 1,
  importance: 5,
  tags: '',
});

const seedForm = (q: AdminQuestion): FormState => {
  const options = q.options.length ? [...q.options] : ['', ''];
  return {
    question: q.question,
    options,
    correctIndex: q.correctAnswer,
    explanation: q.explanation,
    introduction: q.introduction,
    category: q.category,
    difficulty: q.difficulty,
    importance: q.importance,
    tags: q.tags.join(', '),
  };
};

const captionStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-text-secondary)',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 600,
  color: 'var(--color-text-primary)',
  margin: 0,
  marginBottom: 8,
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
  helperText,
  style,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helperText?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <label htmlFor={id} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {children}
      </select>
      {helperText && <span style={captionStyle}>{helperText}</span>}
    </div>
  );
}

export default function QuestionEditor({ open, initial, categories, onClose, onSaved }: Props) {
  const [form, setForm] = useState(() => blankForm(categories));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const baselineRef = useRef('');
  // `saving` reaches handleSave only after a render, so a double click on
  // Save for a new question created it twice. The ref holds from the first.
  const savingRef = useRef(false);

  // Re-seed the form whenever the dialog opens for a different question. The
  // category list is read, not watched: the bank re-read builds a new array,
  // and re-seeding on it wiped what the admin was typing.
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  useEffect(() => {
    if (!open) return;
    setError(null);
    const seeded = initial ? seedForm(initial) : blankForm(categoriesRef.current);
    setForm(seeded);
    baselineRef.current = JSON.stringify(seeded);
  }, [open, initial]);

  const setOption = (index: number, value: string) =>
    setForm((f) => ({ ...f, options: f.options.map((o, i) => (i === index ? value : o)) }));

  const addOption = () =>
    setForm((f) => (f.options.length >= MAX_OPTIONS ? f : { ...f, options: [...f.options, ''] }));

  const removeOption = (index: number) =>
    setForm((f) => {
      if (f.options.length <= MIN_OPTIONS) return f;
      const options = f.options.filter((_, i) => i !== index);
      let correctIndex = f.correctIndex;
      if (index === f.correctIndex) correctIndex = 0;
      else if (index < f.correctIndex) correctIndex -= 1;
      return { ...f, options, correctIndex };
    });

  const validate = (): string | null => {
    if (!form.question.trim()) return 'Question text is required.';
    const filled = form.options.map((o) => o.trim());
    if (filled.some((o) => !o)) return 'All options must have text (remove empty ones).';
    if (filled.length < MIN_OPTIONS) return `At least ${MIN_OPTIONS} options are required.`;
    if (form.correctIndex < 0 || form.correctIndex >= filled.length) return 'Pick the correct answer.';
    return null;
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const payload: QuestionPayload = {
      id: initial?.id,
      question: form.question.trim(),
      options: form.options.map((o) => o.trim()),
      correctIndex: form.correctIndex,
      explanation: form.explanation.trim(),
      introduction: form.introduction.trim(),
      category: form.category,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      difficulty: form.difficulty,
      importance: form.importance,
    };
    try {
      await saveQuestion(payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const requestClose = (next: boolean) => {
    if (next || saving) return;
    if (JSON.stringify(form) === baselineRef.current) {
      onClose();
      return;
    }
    setConfirm({
      title: 'Discard unsaved changes?',
      description: 'Your edits to this question have not been saved.',
      actionLabel: 'Discard changes',
      destructive: true,
      onConfirm: onClose,
    });
  };

  // Keep the confirmation outside the editor so its Escape only closes one dialog.
  return <>
    <Dialog
      isOpen={open}
      onOpenChange={requestClose}
      purpose="form"
      width="min(900px, 96vw)"
      maxHeight="92vh"
      padding={0}
    >
      <DialogHeader title={initial ? 'Edit question' : 'New question'} onOpenChange={requestClose} hasDivider />

      <div style={{ overflowY: 'auto', padding: '16px 20px' }}>
        {error && <Banner status="error" title={error} style={{ marginBottom: 16 }} />}

        <TextArea
          label="Question"
          value={form.question}
          onChange={(v) => setForm((f) => ({ ...f, question: v }))}
          rows={2}
          description="Markdown code fences (``` ```) are rendered as code blocks."
          style={{ marginBottom: 16, width: '100%' }}
        />

        <p style={subtitleStyle}>Options — select the correct answer</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {form.options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="radio"
                name="correct-answer"
                checked={form.correctIndex === i}
                onChange={() => setForm((f) => ({ ...f, correctIndex: i }))}
                aria-label={`Mark option ${i + 1} correct`}
                style={{ width: 18, height: 18, accentColor: 'var(--brand-accent)', flexShrink: 0 }}
              />
              <TextInput
                label={`Option ${i + 1}`}
                isLabelHidden
                value={opt}
                onChange={(v) => setOption(i, v)}
                placeholder={`Option ${i + 1}`}
                size="sm"
                style={{ flex: 1 }}
              />
              <IconButton
                icon={<span aria-hidden>✕</span>}
                label="Remove option"
                tooltip={form.options.length <= MIN_OPTIONS ? `Keep at least ${MIN_OPTIONS}` : 'Remove option'}
                onClick={() => removeOption(i)}
                isDisabled={form.options.length <= MIN_OPTIONS}
                variant="ghost"
                size="sm"
              />
            </div>
          ))}
        </div>
        <Button
          label="+ Add option"
          onClick={addOption}
          isDisabled={form.options.length >= MAX_OPTIONS}
          variant="ghost"
          size="sm"
          style={{ marginBottom: 16 }}
        />

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <SelectField
            label="Category"
            value={form.category}
            onChange={(v) => setForm((f) => ({ ...f, category: v }))}
            style={{ minWidth: 180, flex: 1 }}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {getCategoryLabel(c)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Difficulty"
            value={String(form.difficulty)}
            onChange={(v) => setForm((f) => ({ ...f, difficulty: Number(v) }))}
            style={{ minWidth: 120 }}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={String(d)}>
                {d}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Importance"
            helperText="How essential for a learner (1–10)"
            value={String(form.importance)}
            onChange={(v) => setForm((f) => ({ ...f, importance: Number(v) }))}
            style={{ minWidth: 140 }}
          >
            {IMPORTANCE_LEVELS.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </SelectField>
        </div>

        <TextInput
          label="Tags (comma-separated)"
          value={form.tags}
          onChange={(v) => setForm((f) => ({ ...f, tags: v }))}
          placeholder="useState, Hooks"
          style={{ marginBottom: 16, width: '100%' }}
        />
        <TextArea
          label="Introduction (shown as a hint)"
          value={form.introduction}
          onChange={(v) => setForm((f) => ({ ...f, introduction: v }))}
          rows={2}
          style={{ marginBottom: 16, width: '100%' }}
        />
        <TextArea
          label="Explanation (shown after answering)"
          value={form.explanation}
          onChange={(v) => setForm((f) => ({ ...f, explanation: v }))}
          rows={2}
          style={{ width: '100%' }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 12,
          padding: '12px 20px',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <Button variant="ghost" label="Cancel" onClick={() => requestClose(false)} isDisabled={saving} />
        <Button variant="primary" label={saving ? 'Saving…' : 'Save'} onClick={handleSave} isDisabled={saving} />
      </div>
    </Dialog>
    <BrandedConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
  </>;
}
