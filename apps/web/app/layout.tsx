import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Open Eye - Universal Resource Intelligence & Composition Platform',
  description: 'Open Eye is an AI-powered intelligence layer for the resources your team learns from and builds with. It understands repositories, websites, videos, documents, and other sources, connecting their capabilities, knowledge, and evidence to solve engineering and research problems.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👁️</text></svg>" />
      </head>
      <body>{children}</body>
    </html>
  );
}
