import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'TrustRoute — AI Agent Security Gateway',
  description:
    'Screen untrusted content before an AI agent reads it: prompt injection detection, personal-data masking and static script inspection, with a deterministic policy decision.',
  applicationName: 'TrustRoute',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
