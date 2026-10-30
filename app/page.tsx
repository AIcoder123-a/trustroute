import { Workbench } from '@/components/Workbench';
import { LIMITS, resolveRunMode } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default function Page() {
  // Read at request time, never baked into the build: a deployment that gains a
  // key must start reporting `live` without a rebuild.
  let mode: 'live' | 'mock' = 'mock';
  try {
    mode = resolveRunMode();
  } catch {
    mode = 'mock';
  }

  return (
    <Workbench
      mode={mode}
      limits={{ proseCharacters: LIMITS.proseCharacters, scriptCharacters: LIMITS.scriptCharacters }}
    />
  );
}
