'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field as FieldScope } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-3xl',
} as const;

/**
 * Unified creation/edit dialog shell for the whole app — bold title + muted
 * description, a scrollable body, and a footer of outline Cancel + solid submit
 * (disabled until valid). ⌘/Ctrl+Enter submits. Mirrors the project dialog so
 * every "New X" form looks and behaves the same. Compose the body with <Field>.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
  submitting,
  disabled,
  cancelLabel,
  size = 'lg',
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  submitLabel: React.ReactNode;
  onSubmit: () => void;
  submitting?: boolean;
  disabled?: boolean;
  cancelLabel?: React.ReactNode;
  size?: keyof typeof SIZES;
  children: React.ReactNode;
}) {
  const tc = useTranslations('common');
  const blocked = !!disabled || !!submitting;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('max-h-[90vh] overflow-y-auto', SIZES[size])}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !blocked) {
            e.preventDefault();
            onSubmit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="flex flex-col gap-4">{children}</div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel ?? tc('cancel')}
          </Button>
          <Button type="button" disabled={blocked} onClick={onSubmit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A labelled form field: <Label> (with optional required marker) over its control. */
export function Field({
  label,
  required,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label?: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  error?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <FieldScope className={cn('flex flex-col gap-1.5', className)}>
      {label != null && (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
      )}
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </FieldScope>
  );
}

/** Responsive column grid for grouping fields (2 or 3 columns on ≥sm). */
export function FormGrid({
  cols = 2,
  className,
  children,
}: {
  cols?: 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid gap-4', cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2', className)}>
      {children}
    </div>
  );
}
