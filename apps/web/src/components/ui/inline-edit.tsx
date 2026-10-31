'use client';

import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Linear-style click-to-edit text. Renders as plain text until clicked, then an
 * input/textarea. Enter (or blur) saves, Escape cancels. `multiline` uses a
 * self-growing textarea and saves on blur / ⌘+Enter.
 */
export function InlineEdit({
  value,
  onSave,
  multiline = false,
  placeholder,
  disabled,
  className,
  textClassName,
}: {
  value: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  textClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // outside edit mode the draft follows the saved value
  if (!editing && draft !== value) setDraft(value);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      const el = ref.current;
      el.setSelectionRange(el.value.length, el.value.length);
      if (multiline) {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }
    }
  }, [editing, multiline]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== value.trim() && (next || multiline)) onSave(next);
    else setDraft(value);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setEditing(true)}
        className={cn(
          'group/inline -mx-1 flex w-full items-start gap-1.5 rounded px-1 text-left transition-colors',
          !disabled && 'hover:bg-accent/60',
          className,
        )}
      >
        <span className={cn('min-w-0 flex-1 whitespace-pre-wrap', !value && 'italic text-muted-foreground', textClassName)}>
          {value || placeholder || '—'}
        </span>
        {!disabled && (
          <Pencil className="mt-1 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/inline:opacity-100" />
        )}
      </button>
    );
  }

  const shared = {
    value: draft,
    placeholder,
    onBlur: commit,
    className: cn(
      '-mx-1 w-full rounded border border-input bg-background px-1 py-0.5 outline-none ring-2 ring-ring/30',
      textClassName,
    ),
  };

  return multiline ? (
    <textarea
      {...shared}
      ref={(el) => { ref.current = el; }}
      rows={2}
      onChange={(e) => {
        setDraft(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
      }}
    />
  ) : (
    <input
      {...shared}
      ref={(el) => { ref.current = el; }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
        if (e.key === 'Enter') commit();
      }}
    />
  );
}
