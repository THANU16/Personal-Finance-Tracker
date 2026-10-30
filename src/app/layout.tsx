import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/shared/providers";
import { hideAmountsScript } from "@/lib/hide-amounts-script";
import { SPLASH_SCREENS } from "@/lib/splash-screens";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "WealthTrack", template: "%s · WealthTrack" },
  description: "Personal finance and portfolio tracker",
  applicationName: "WealthTrack",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: {
    capable: true,
    title: "WealthTrack",
    statusBarStyle: "default",
    startupImage: SPLASH_SCREENS.map((s) => ({ url: `/splash/${s.file}`, media: s.media })),
  },
};

export const viewport: Viewport = {
  // Edge-to-edge on notched iPhones; the shell pads itself with env(safe-area-inset-*) (docs/07 §1).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes and the hide-amounts script set attributes on <html> before hydration
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: hideAmountsScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
