export function PageIntro({ title, description }: { title: string; description: string }) {
  return <div className="shrink-0 px-5 pb-4 pt-5"><h2 className="font-display text-2xl font-medium tracking-tight">{title}</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{description}</p></div>
}
