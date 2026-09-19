import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Repo Intelligence - Open-World Repository Intelligence & Composition Engine',
  description: 'AI-powered open-world repository intelligence, multi-repo composition, and verified architectural reasoning across arbitrary domains.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
