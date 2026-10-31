'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Paperclip,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMembers } from '@/components/hr/use-members';

interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedById: string;
  createdAt: string;
}

const MAX_SIZE = 50 * 1024 * 1024;

function iconFor(mime: string): React.ElementType {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.includes('zip') || mime.includes('compressed')) return FileArchive;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return FileSpreadsheet;
  if (mime.includes('pdf') || mime.includes('word') || mime.startsWith('text/')) return FileText;
  return File;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Generic document attachments for any QMS entity (MinIO presigned uploads).
 * Attaching documents is always optional — the panel just offers it.
 */
export function AttachmentsPanel({
  entityType,
  entityId,
  canEdit,
}: {
  entityType: string;
  entityId: string;
  canEdit: boolean;
}) {
  const t = useTranslations('attachments');
  const tc = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;
  const queryClient = useQueryClient();
  const { nameOf } = useMembers();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const queryKey = ['attachments', entityType, entityId];
  const { data: attachments, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiGet<Attachment[]>(`/attachments/by-entity/${entityType}/${entityId}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const onErr = (err: unknown) => {
    if (err instanceof ApiError && (err.details as { error?: string } | undefined)?.error === 'STORAGE_QUOTA') {
      toast.error(t('storageQuota'));
      return;
    }
    toast.error(err instanceof ApiError ? err.message : tc('error'));
  };

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_SIZE) {
          toast.error(t('tooLarge', { name: file.name }));
          continue;
        }
        const { uploadUrl } = await apiPost<{ uploadUrl: string }>('/attachments/presign', {
          entityType,
          entityId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
        });
        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!res.ok) throw new ApiError(res.status, t('uploadFailed', { name: file.name }));
      }
      invalidate();
      toast.success(t('uploaded'));
    } catch (err) {
      onErr(err);
      invalidate(); // presigned rows may exist even when the PUT failed
    } finally {
      setUploading(false);
    }
  };

  const download = useMutation({
    mutationFn: (id: string) => apiGet<{ url: string }>(`/attachments/${id}/download-url`),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/attachments/${id}`),
    onSuccess: invalidate,
    onError: onErr,
  });

  return (
    <div className="flex flex-col gap-2">
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <>
          {attachments?.map((a) => {
            const Icon = iconFor(a.mimeType);
            return (
              <div key={a.id} className="flex items-center gap-3 rounded-md border p-2.5">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatSize(a.size)} · {nameOf(a.uploadedById)} ·{' '}
                    {format(new Date(a.createdAt), 'd MMM yyyy', { locale: dateLocale })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title={t('download')}
                  disabled={download.isPending}
                  onClick={() => download.mutate(a.id)}
                >
                  <Download className="size-3.5 text-muted-foreground" />
                </Button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={tc('delete')}
                    onClick={() => { if (confirm(t('deleteConfirm', { name: a.fileName }))) remove.mutate(a.id); }}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            );
          })}
          {!attachments?.length && (
            <p className="flex items-center justify-center gap-1.5 py-2 text-center text-sm text-muted-foreground">
              <Paperclip className="size-3.5" /> {t('empty')}
            </p>
          )}
        </>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
          }}
          disabled={uploading}
          className={cn(
            'flex flex-col items-center gap-1 rounded-md border border-dashed p-4 text-sm text-muted-foreground transition-colors',
            dragging ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-accent/50',
            uploading && 'pointer-events-none opacity-60',
          )}
        >
          <UploadCloud className="size-5" />
          {uploading ? t('uploading') : t('dropHint')}
          <span className="text-[10px]">{t('maxSize')}</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
