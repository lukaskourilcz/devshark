// Report-a-question dialog. Lets a learner flag a problem with a question by
// picking a reason and (optionally) adding detail. Redesigned on the Astryx
// design system: an Astryx form Dialog with a RadioList of reasons, a TextArea
// for detail, and a Banner for submit errors. All logic is preserved.

import { useDialogTitleFocus } from './ui/useDialogTitleFocus';
import { useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { TextArea } from '@astryxdesign/core/TextArea';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { useT } from '../i18n/LanguageContext';

/** Why a learner reports a question; Quiz, Challenge and the Learn runner share it. */
export type ReportReason = 'incorrect-answer' | 'unclear' | 'typo' | 'outdated' | 'duplicate' | 'other';
type Reason = ReportReason;

const REASON_VALUES: Reason[] = ['incorrect-answer', 'unclear', 'typo', 'outdated', 'duplicate', 'other'];

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: Reason, detail?: string) => void | Promise<void>;
}

export function ReportDialog({ open, onClose, onSubmit }: Props) {
  const t = useT();
  const headerFocus = useDialogTitleFocus(open);
  const [reason, setReason] = useState<Reason>('incorrect-answer');
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(reason, detail.trim() || undefined);
      setDetail('');
      setReason('incorrect-answer');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quiz.reportFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setError(null);
    onClose();
  };

  return (
    <Dialog
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
      purpose="form"
      width="min(560px, 94vw)"
    >
      <DialogHeader
        ref={headerFocus}
        title={t('report.title')}
        onOpenChange={(next) => {
          if (!next) handleClose();
        }}
      />
      <VStack gap={3} padding={4} width="100%">
        <RadioList
          label={t('report.reasonLabel')}
          value={reason}
          onChange={(value) => setReason(value as Reason)}
        >
          {REASON_VALUES.map((value) => (
            <RadioListItem key={value} value={value} label={t(`report.reason.${value}` as const)} />
          ))}
        </RadioList>

        <TextArea
          label={t('report.detailLabel')}
          value={detail}
          onChange={(value) => setDetail(value.slice(0, 1000))}
          maxLength={1000}
          rows={3}
          isOptional
        />

        {error && <Banner status="error" title={error} />}

        <HStack gap={1.5} justify="end" width="100%">
          <Button variant="ghost" label={t('common.cancel')} onClick={handleClose} isDisabled={submitting} />
          <Button
            variant="primary"
            label={submitting ? t('report.sending') : t('report.send')}
            onClick={handleSubmit}
            isLoading={submitting}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
