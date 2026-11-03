import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'TrustRoute — AI Agent Security Gateway',
  description:
    'Screen untrusted content before an AI agent reads it: prompt injection detection, personal-data masking and static script inspection, with a deterministic policy decision.',
  applicationName: 'TrustRoute',
  robots: { index: true, follow: true },
  other: {
    // Browser auto-translation rewrites text nodes and splits the inline
    // highlight spans the evidence locator depends on.
    google: 'notranslate',
  },
};

export const viewport: Viewport = {
  themeColor: '#f6f7f6',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" translate="no" className="notranslate">
      <body>{children}</body>
    </html>
  );
}
