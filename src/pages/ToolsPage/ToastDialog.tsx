import { useEffect } from 'react';

interface ToastDialogProps {
  message: string;
  onClose: () => void;
  title?: string;
}

export function ToastDialog({ message, onClose, title }: ToastDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="live2d-error-dialog-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="live2d-error-dialog"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="live2d-error-dialog__title">{title}</div>}
        <div className="live2d-error-dialog__message">{message}</div>
        <div className="live2d-error-dialog__actions">
          <button
            type="button"
            className="live2d-error-dialog__button"
            onClick={onClose}
            autoFocus
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
