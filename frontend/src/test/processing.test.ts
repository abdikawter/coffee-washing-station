import type { Principal } from '../api/types';
import { DELIVERED_PHASE, NAV_ITEMS, visibleNav } from '../navigation';

const nav = (permissions: string[]) =>
  visibleNav({ id: '1', username: 'u', fullName: 'U', email: null, mustChangePassword: false, roles: [], permissions } as Principal).map((i) => i.label);

describe('wet processing navigation (Phase 3)', () => {
  it('is delivered', () => {
    expect(DELIVERED_PHASE).toBeGreaterThanOrEqual(3);
    for (const label of ['Lots & traceability', 'Wet processing']) {
      expect(NAV_ITEMS.find((i) => i.label === label)?.phase).toBeLessThanOrEqual(DELIVERED_PHASE);
    }
  });

  it('shows lots and the processing board to process operators', () => {
    expect(nav(['lot:read', 'hopper:read', 'pulping:read', 'fermentation:read'])).toEqual(expect.arrayContaining(['Lots & traceability', 'Wet processing']));
    expect(nav(['lot:lookup'])).toEqual(['Dashboard', 'Lots & traceability']);
    expect(nav(['purchase:read'])).not.toContain('Wet processing');
  });
});
