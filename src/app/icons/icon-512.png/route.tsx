import { renderAppIcon } from "@/lib/app-icon";

// PWA icon (Phase 12); a static route handler, prerendered at build.
export function GET() {
  return renderAppIcon(512);
}
