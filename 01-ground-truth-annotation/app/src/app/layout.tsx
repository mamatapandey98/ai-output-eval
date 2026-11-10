import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ground-truth annotation",
  description: "Write the reference answers for the AI output evaluation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full light">
      <body
        className={`h-full bg-slate-50 text-slate-900 flex flex-col antialiased selection:bg-slate-900 selection:text-white`}
      >
        {children}
      </body>
    </html>
  );
}
