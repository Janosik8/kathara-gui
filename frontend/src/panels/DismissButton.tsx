/**
 * A × that closes a message which would otherwise stay until the next action
 * replaced it (test step 3A.1). Named for what it closes, so a screen reader
 * says more than "times".
 */
export function DismissButton({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button type="button" className="dismiss" aria-label={label} title={label} onClick={onDismiss}>
      <span aria-hidden="true">×</span>
    </button>
  );
}
