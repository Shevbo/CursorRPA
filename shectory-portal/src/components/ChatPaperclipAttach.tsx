"use client";

export function ChatPaperclipAttach({
  disabled,
  onPickFiles,
  title = "Файлы (или вставка из буфера: Ctrl+V)",
  className = "",
}: {
  disabled?: boolean;
  onPickFiles: () => void;
  title?: string;
  /** Дополнительные классы позиционирования; по умолчанию только кнопка. */
  className?: string;
}) {
  return (
    <button
      type="button"
      className={
        `flex size-8 items-center justify-center rounded-md border border-slate-600/90 bg-slate-950/95 text-slate-400 shadow-sm hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40 ${className}`.trim()
      }
      aria-label="Прикрепить файлы"
      title={title}
      disabled={disabled}
      onClick={onPickFiles}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[18px]"
        aria-hidden
      >
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
    </button>
  );
}
