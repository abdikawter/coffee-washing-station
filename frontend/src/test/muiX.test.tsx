import { render, screen } from '@testing-library/react';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import { DataGrid } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import { ColorModeProvider } from '../theme';

describe('MUI X libraries (spec §3)', () => {
  it('render inside the app theme and date adapter', () => {
    render(
      <ColorModeProvider>
        <div style={{ height: 300, width: 600 }}>
          <DataGrid rows={[{ id: 1, code: 'SUP-001' }]} columns={[{ field: 'code', headerName: 'Code' }]} />
        </div>
        <SparkLineChart data={[1, 3, 2]} height={40} width={120} />
        <DatePicker label="Day" value={dayjs('2026-10-05')} />
      </ColorModeProvider>,
    );
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();
    // en-GB day-first format from the theme defaults.
    expect(screen.getByRole('group', { name: 'Day' })).toHaveTextContent(/05\s*Oct\s*2026/);
  });
});
