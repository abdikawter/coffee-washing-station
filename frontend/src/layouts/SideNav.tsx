import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Box, Chip, Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Toolbar, Tooltip } from '@mui/material';
import { Fragment } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { DELIVERED_PHASE, type NavItem } from '../navigation';

export const NAV_WIDTH = 264;
export const NAV_WIDTH_COLLAPSED = 72;

export function isActivePath(path: string, pathname: string): boolean {
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Left navigation grouped by section (spec §6). `collapsed` = icons only with
 * tooltips (desktop); `onToggle` shows the collapse button; `onNavigate` closes the mobile drawer.
 */
export function SideNav({ items, collapsed = false, onToggle, onNavigate }: {
  items: NavItem[];
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const sections = [...new Set(items.map((i) => i.section))];
  return (
    <Box component="nav" aria-label="Main" sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar />
      <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {sections.map((section, si) => (
          <Fragment key={section}>
            {collapsed ? (si > 0 && <Divider sx={{ my: 1, mx: 2 }} />) : (
              <ListSubheader component="div" sx={{ bgcolor: 'transparent', lineHeight: '32px', mt: 1, typography: 'overline', color: 'text.secondary' }}>
                {section}
              </ListSubheader>
            )}
            <List dense disablePadding aria-label={section}>
              {items.filter((i) => i.section === section).map((i) => {
                const active = isActivePath(i.path, pathname);
                const coming = i.phase > DELIVERED_PHASE;
                const button = (
                  <ListItemButton
                    component={RouterLink} to={i.path} selected={active} onClick={onNavigate}
                    aria-current={active ? 'page' : undefined} aria-label={collapsed ? i.label : undefined}
                    sx={{
                      mx: 1, my: 0.25, borderRadius: 2, minHeight: 44, justifyContent: collapsed ? 'center' : 'flex-start',
                      '&.Mui-selected': { bgcolor: 'action.selected', '& .MuiListItemIcon-root': { color: 'primary.main' }, '& .MuiListItemText-primary': { fontWeight: 600 } },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, color: 'text.secondary' }}>{i.icon}</ListItemIcon>
                    {!collapsed && <ListItemText primary={i.label} />}
                    {!collapsed && coming && <Chip size="small" label={`P${i.phase}`} variant="outlined" sx={{ height: 20 }} title={`Coming in phase ${i.phase}`} />}
                  </ListItemButton>
                );
                return collapsed
                  ? <Tooltip key={i.path} title={coming ? `${i.label} (phase ${i.phase})` : i.label} placement="right">{button}</Tooltip>
                  : <Fragment key={i.path}>{button}</Fragment>;
              })}
            </List>
          </Fragment>
        ))}
      </Box>
      {onToggle && (
        <>
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end', p: 1 }}>
            <Tooltip title={collapsed ? 'Expand menu' : 'Collapse menu'} placement="right">
              <IconButton onClick={onToggle} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
                {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </>
      )}
    </Box>
  );
}
