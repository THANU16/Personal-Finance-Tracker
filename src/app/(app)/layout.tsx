// Phase 1 adds the sidebar, topbar, quick-add and notifications shell (docs/05 §1).
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
}
