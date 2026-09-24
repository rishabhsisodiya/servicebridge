import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ServiceBridge", template: "%s · ServiceBridge" },
  description: "Field service and ERP operations in one place.",
};

// Fonts (Fira Sans / Fira Code) and design tokens are added in session 2.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
