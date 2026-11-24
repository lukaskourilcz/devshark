// Lightweight "this looks wrong" flag shown next to a question. The note is
// optional; ticking "this question should be reviewed" is the only thing the
// user must do to send the flag (it's what triggers the notification), so the
// submit button stays disabled until the box is checked.
//
// Redesigned on the Astryx design system: an Astryx form Dialog with a TextArea
// note, a CheckboxInput confirmation, and a Banner for submit errors. All logic
// is preserved.

import { useDialogTitleFocus } from './ui/useDialogTitleFocus';
import { useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { TextArea } from '@astryxdesign/core/TextArea';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { useT } from '../i18n/LanguageContext';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when the user confirms the flag. `detail` is the optional note. */
  onSubmit: (detail?: string) => void | Promise<void>;
}

export function RedFlagDialog({ open, onClose, onSubmit }: Props) {
  const t = useT();
  const headerFocus = useDialogTitleFocus(open);
  const [detail, setDetail] = useState('');
  const [review, setReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDetail('');
    setReview(false);
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!review) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(detail.trim() || undefined);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('flag.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
      purpose="form"
      width="min(520px, 94vw)"
    >
      <DialogHeader
        ref={headerFocus}
        title={t('flag.title')}
        onOpenChange={(next) => {
          if (!next) handleClose();
        }}
      />
      <VStack gap={3} padding={4} width="100%">
        <Text type="body" color="secondary">
          {t('flag.intro')}
        </Text>

        <TextArea
          label={t('flag.detailLabel')}
          value={detail}
          onChange={(value) => setDetail(value.slice(0, 1000))}
          maxLength={1000}
          rows={3}
          isOptional
        />

        <CheckboxInput
          label={t('flag.reviewLabel')}
          value={review}
          onChange={(checked) => setReview(checked)}
          isRequired
        />

        {error && <Banner status="error" title={error} />}

        <HStack gap={1.5} justify="end" width="100%">
          <Button variant="ghost" label={t('common.cancel')} onClick={handleClose} isDisabled={submitting} />
          <Button
            variant="primary"
            label={submitting ? t('flag.sending') : t('flag.send')}
            onClick={handleSubmit}
            isLoading={submitting}
            isDisabled={!review || submitting}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
