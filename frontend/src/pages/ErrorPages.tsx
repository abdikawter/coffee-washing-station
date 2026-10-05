import ConstructionOutlined from '@mui/icons-material/ConstructionOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { EmptyState } from '../components/EmptyState';

const home = { label: 'Back to dashboard', to: '/' };

export const ForbiddenPage = () => (
  <EmptyState icon={<LockOutlined />} title="No access" message="Your role does not include this page. Ask the site manager if you need it." action={home} />
);
export const NotFoundPage = () => (
  <EmptyState icon={<SearchOffOutlined />} title="Page not found" message="The address does not match any page." action={home} />
);
export const ComingSoonPage = ({ label, phase }: { label: string; phase: number }) => (
  <EmptyState icon={<ConstructionOutlined />} title={label}
    message={`This module is delivered in Phase ${phase} of the roadmap. Your access to it is already configured.`} action={home} />
);
