import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Labs",
  description: "Intercept and log HTTP calls with mock support",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
