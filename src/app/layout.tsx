import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Omni",
  description: "All-in-one workspace for your field team.",
  icons: {
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Omni",
    statusBarStyle: "black-translucent",
  },
};

// Next only emits what's listed here once you export a custom `viewport` —
// it does NOT fall back to its usual width/initial-scale defaults. Omitting
// them (as before) left mobile/PWA shells with no viewport meta tag at all,
// so they rendered at desktop width and needed a manual pinch-zoom-out to
// read. viewportFit: "cover" lets the app draw under the iOS notch/home
// indicator (paired with safe-area padding in globals.css).
export const viewport: Viewport = {
  themeColor: "#031142",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
