import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kira — The teacher you always wished you had",
  description:
    "An AI companion that sits next to you while you learn. Not a course. Not a tutorial. A friend who teaches.",
  keywords: ["AI tutor", "learning companion", "personalized learning", "AI teacher"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-kira-bg text-kira-text antialiased">{children}</body>
    </html>
  );
}
