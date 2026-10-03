import type { Metadata, Viewport } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { themeInitScript } from "@/lib/theme/theme";
import "./globals.css";

// Self-hosted at build time by next/font: the browser never calls Google.
const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira-sans",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  variable: "--font-fira-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "ERPTick", template: "%s · ERPTick" },
  description: "Field service and ERP operations in one place.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f1c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is corrected before first paint by themeInitScript, hence suppressHydrationWarning.
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${firaSans.variable} ${firaCode.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
