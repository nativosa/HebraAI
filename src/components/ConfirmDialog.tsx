import React, { useEffect, useRef } from "react";
import { Button } from "./ui";

type Props = {
  // null: closed.
  message: string | null;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

// A modal confirmation using the native <dialog> (focus handling and Esc
// come from the browser).
export default function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (message && !dialog.open) dialog.showModal();
    if (!message && dialog.open) dialog.close();
  }, [message]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-5 text-fg shadow-xl backdrop:bg-black/40"
    >
      <h2 id="confirm-title" className="text-base font-semibold">
        Discard the current result?
      </h2>
      <p className="mt-2 text-sm text-fg-2">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button autoFocus onClick={onCancel}>
          Keep it
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
