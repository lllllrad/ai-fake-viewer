import { useRef, useId, type ComponentProps, type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";

export function Button({
  className = "",
  type,
  ...props
}: ComponentProps<"button">) {
  const variant = /danger|stop/.test(className)
    ? "btn-outline-danger"
    : /secondary/.test(className)
      ? "btn-outline-secondary"
      : "btn-primary";
  return (
    <button type={type} className={`btn ${variant} ${className}`} {...props} />
  );
}
export function Input({
  className = "",
  type,
  ...props
}: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={`${type === "checkbox" ? "form-check-input" : "form-control"} ${className}`}
      {...props}
    />
  );
}
export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select className={`form-select ${className}`} {...props} />;
}
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  return (
    <>
      <Button {...props} onClick={() => dialog.current?.showModal()}>
        {children}
      </Button>
      <dialog
        ref={dialog}
        className="confirm-dialog"
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        <div className="toolbar dialog-actions">
          <Button
            type="button"
            className="secondary"
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            취소
          </Button>
          <Button
            type="button"
            className="danger"
            onClick={() => {
              dialog.current?.close();
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}

export function SectionTabs({
  label,
  items,
  value,
  onValueChange,
  defaultValue,
}: {
  label: string;
  items: { value: string; label: string; content: ReactNode }[];
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
}) {
  return (
    <Tabs.Root
      value={value}
      onValueChange={onValueChange}
      defaultValue={defaultValue ?? items[0]?.value}
      activationMode="automatic"
    >
      <Tabs.List className="section-tabs nav nav-tabs" aria-label={label}>
        {items.map((item) => (
          <Tabs.Trigger
            className="nav-link"
            key={item.value}
            value={item.value}
          >
            {item.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {items.map((item) => (
        <Tabs.Content
          className="section-tab-panel"
          forceMount
          key={item.value}
          value={item.value}
        >
          {item.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return <span className={`state-badge state-${tone}`}>{children}</span>;
}
