import { Link } from "@tanstack/react-router";

type DataEmptyStateProps = {
  title: string;
  description: string;
  linkTo?: "/" | "/calendar" | "/teams" | "/odds";
  linkLabel?: string;
};

export function DataEmptyState({ title, description, linkTo, linkLabel }: DataEmptyStateProps) {
  return (
    <div className="rounded-md border border-dashed border-border-strong bg-surface px-5 py-8 text-center shadow-[var(--shadow-border)]">
      <p className="font-display text-2xl tracking-wide">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">{description}</p>
      {linkTo && linkLabel ? (
        <Link to={linkTo} className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline-offset-2 hover:underline">
          {linkLabel} →
        </Link>
      ) : null}
    </div>
  );
}
