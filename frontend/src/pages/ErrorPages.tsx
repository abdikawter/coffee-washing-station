import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

function Message({ title, text }: { title: string; text: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 8 }}>
      <Typography variant="h5" gutterBottom>{title}</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>{text}</Typography>
      <Button component={RouterLink} to="/" variant="outlined">Back to dashboard</Button>
    </Box>
  );
}

export const ForbiddenPage = () => <Message title="No access" text="Your role does not include this page. Ask the site manager if you need it." />;
export const NotFoundPage = () => <Message title="Page not found" text="The address does not match any page." />;
export const ComingSoonPage = ({ label, phase }: { label: string; phase: number }) => (
  <Message title={label} text={`This module is delivered in Phase ${phase} of the roadmap. Your access to it is already configured.`} />
);
