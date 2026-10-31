import { Badge } from '@/components/ui/badge';

export function PageHeader({
  title,
  clause,
  description,
  actions,
}: {
  title: string;
  clause?: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-balance">
            {title}
          </h1>
          {clause && (
            <Badge
              variant="outline"
              className="border-primary/20 bg-primary/5 font-mono text-[11px] font-medium text-primary/90"
            >
              ISO {clause}
            </Badge>
          )}
        </div>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
