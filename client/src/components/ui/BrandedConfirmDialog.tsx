import { useEffect, useRef, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { useT } from '../../i18n/LanguageContext';

export interface ConfirmRequest {
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
}

/** Shared confirmation behavior; visual identity comes from the global Deep End dialog surface. */
export function BrandedConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  // `busy` reaches this handler only after a render, so a second press in
  // that gap (a double click, Enter held down) ran a delete or an account
  // erasure twice. The ref holds from the first press.
  const busyRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (request) dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [request]);


  const confirm = async () => {
    if (!request || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await request.onConfirm();
      onClose();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      ref={dialog}
      className="ss-alert-dialog"
      isOpen={!!request}
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title={request?.title ?? ''}
      description={request?.description ?? ''}
      cancelLabel={t('common.cancel')}
      actionLabel={request?.actionLabel ?? ''}
      actionVariant={request?.destructive === false ? 'primary' : 'destructive'}
      isActionLoading={busy}
      onAction={confirm}
      width="min(460px, calc(100vw - 32px))"
    />
  );
}
