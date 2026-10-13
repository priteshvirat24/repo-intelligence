import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import '../styles/globals.css';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--ff-display',
  axes: ['opsz'],
  display: 'swap'
});

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--ff-sans',
  display: 'swap'
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--ff-mono',
  display: 'swap'
});

// Favicon: the Open Eye mark (ink almond, vermilion pupil). SVG data URIs cannot read CSS tokens,
// so the two brand values are inlined here only.
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23F3EFE6'/%3E%3Cpath d='M3 16C7.5 8.5 24.5 8.5 29 16C24.5 23.5 7.5 23.5 3 16Z' fill='none' stroke='%23141412' stroke-width='2.5' stroke-linejoin='round'/%3E%3Ccircle cx='17.5' cy='16' r='4.5' fill='%23E8452C' stroke='%23141412' stroke-width='2'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: 'Open Eye — ask questions of your GitHub repositories',
  description:
    'Open Eye indexes GitHub repositories and answers questions about them, citing the exact files and lines it used. Claims it cannot verify are marked as inferred.',
  icons: { icon: FAVICON }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3EFE6' },
    { media: '(prefers-color-scheme: dark)', color: '#161513' }
  ]
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
