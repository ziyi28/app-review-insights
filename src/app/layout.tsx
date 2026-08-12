import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "App Review Planner",
  description: "Model-driven analysis of App Store reviews into evidence-grounded product plans",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
