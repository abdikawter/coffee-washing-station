import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { settingsApi } from '../api/endpoints';
import { lotsApi } from '../api/processing';
import { purchasesApi, suppliersApi } from '../api/procurement';
import { AppShell } from '../layouts/AppShell';
import { LanguageSwitch } from '../layouts/TopBarActions';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { LoginPage } from '../pages/LoginPage';
import { useColorMode } from '../theme';
import { setup, where } from './render';

/** Desktop = every `min-width` media query matches (jsdom has no layout). */
function desktop(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes('min-width'), media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function ModeName() {
  return <output data-testid="mode">{useColorMode().mode}</output>;
}

const ADMIN = ['user:read', 'role:read', 'settings:read', 'settings:manage', 'auditlog:read', 'supplier:read', 'purchase:read', 'lot:read'];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(settingsApi, 'unconfirmed').mockResolvedValue([]);
});

describe('AppShell navigation', () => {
  it('groups permitted items by section and marks the current page', () => {
    desktop(true);
    setup(<AppShell><p>page body</p></AppShell>, { permissions: ['supplier:read', 'user:read'], url: '/suppliers' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('list', { name: 'Operations' })).toBeInTheDocument();
    expect(within(nav).getByRole('list', { name: 'Administration' })).toBeInTheDocument();
    expect(within(nav).queryByText('Purchasing')).not.toBeInTheDocument(); // no purchase:read
    expect(within(nav).getByRole('link', { name: /Suppliers/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toHaveTextContent('page body');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
  });

  it('collapses to icons on desktop and remembers it', async () => {
    desktop(true);
    const { unmount } = setup(<AppShell><p /></AppShell>, { permissions: ['supplier:read'] });
    await userEvent.click(screen.getByRole('button', { name: 'Collapse menu' }));
    expect(screen.queryByText('Suppliers')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Suppliers' })).toBeInTheDocument(); // icon keeps its name
    expect(localStorage.getItem('cws.nav.collapsed')).toBe('1');
    unmount();
    setup(<AppShell><p /></AppShell>, { permissions: ['supplier:read'] });
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeInTheDocument();
  });

  it('opens the menu as a drawer on phones and closes it after navigating', async () => {
    desktop(false);
    setup(<AppShell><p /></AppShell>, { permissions: ['supplier:read'] });
    expect(screen.queryByRole('button', { name: 'Collapse menu' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await userEvent.click(await screen.findByRole('link', { name: /Suppliers/ }));
    expect(where()).toBe('/suppliers');
    await waitFor(() => expect(screen.queryByRole('presentation')).not.toBeInTheDocument());
  });
});

describe('top bar', () => {
  it('searches only the lists the user may read and opens the hit', async () => {
    desktop(true);
    const lots = vi.spyOn(lotsApi, 'list').mockResolvedValue({ data: [{ id: 'l1', lotNumber: 'LOT-2026-0007', currentStage: 'PULPING', status: 'ACTIVE' }] as never, meta: { page: 1, pageSize: 5, total: 1 } });
    const vouchers = vi.spyOn(purchasesApi, 'list');
    const suppliers = vi.spyOn(suppliersApi, 'list');
    setup(<AppShell><p /></AppShell>, { permissions: ['lot:read'] });
    await userEvent.type(screen.getByRole('combobox', { name: 'Search lot, voucher or supplier' }), 'LOT-7');
    await userEvent.click(await screen.findByText('LOT-2026-0007'));
    expect(where()).toBe('/lots/l1');
    expect(lots).toHaveBeenCalledWith({ page: 1, pageSize: 5, search: 'LOT-7' });
    expect(vouchers).not.toHaveBeenCalled();
    expect(suppliers).not.toHaveBeenCalled();
  });

  it('user menu switches theme and signs out', async () => {
    desktop(true);
    const { auth } = setup(<><AppShell><p /></AppShell><ModeName /></>, { permissions: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Open user menu' }));
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveTextContent('Test User');
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /Dark/ }));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Sign out/ }));
    await waitFor(() => expect(where()).toBe('/login'));
    expect(auth.logout).toHaveBeenCalled();
  });

  it('language switch remembers the choice and sets <html lang>', async () => {
    setup(<LanguageSwitch />);
    await userEvent.click(screen.getByRole('button', { name: 'Amharic' }));
    expect(document.documentElement.lang).toBe('am');
    expect(localStorage.getItem('cws.language')).toBe('am');
  });
});

describe('settings bar', () => {
  it('shows the count, links to review and can be dismissed for the session', async () => {
    desktop(true);
    vi.spyOn(settingsApi, 'unconfirmed').mockResolvedValue([{ key: 'a' }, { key: 'b' }] as never);
    setup(<AppShell><p /></AppShell>, { permissions: ADMIN });
    expect(await screen.findByText('2 settings still need confirmation by the site manager.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/admin/settings?filter=unconfirmed');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/still need confirmation/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('cws.settingsBar.dismissed')).toBe('2');
  });
});

describe('login and password pages', () => {
  it('login uses the split layout and can reveal the password', async () => {
    setup(<LoginPage />, { url: '/login', signedOut: true });
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveTextContent('Coffee Washing Station');
    expect(screen.getByRole('img', { name: 'Coffee branch with ripe cherries' })).toBeInTheDocument();
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
  });

  it('a voluntary password change offers Back instead of Sign out', () => {
    setup(<ChangePasswordPage />, { url: '/change-password' });
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });
});
