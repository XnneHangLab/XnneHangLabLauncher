import { useEffect } from 'react';

interface Live2DErrorDialogProps {
  message: string;
  onClose: () => void;
}

export function Live2DErrorDialog({ message, onClose }: Live2DErrorDialogProps) {
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
        aria-labelledby="live2d-error-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="live2d-error-dialog-title" className="live2d-error-dialog__title">
          无法加载模型
        </div>
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