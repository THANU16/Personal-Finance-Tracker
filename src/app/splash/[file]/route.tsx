import { renderSplash } from "@/lib/app-icon";
import { SPLASH_SCREENS } from "@/lib/splash-screens";

// iOS launch screens (docs/07 §7), drawn in code like the icons; prerendered at build, and any
// other name is a 404.

export function generateStaticParams() {
  return SPLASH_SCREENS.map((s) => ({ file: s.file }));
}

export async function GET(_req: Request, { params }: RouteContext<"/splash/[file]">) {
  const { file } = await params;
  const screen = SPLASH_SCREENS.find((s) => s.file === file);
  if (!screen) return new Response("Not found", { status: 404 });
  return renderSplash(screen.width, screen.height, screen.theme);
}
