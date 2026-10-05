// The five page templates (docs/UI_REFRESH_SPEC.md §5). Every page uses one of them.
export { ListTemplate, type ListTemplateProps, type QuickView } from './ListTemplate';
export { DetailTemplate, type DetailTemplateProps, type DetailTab, type KeyFigure } from './DetailTemplate';
export { FormGrid, FormTemplate, type FormTemplateProps, type WizardStep } from './FormTemplate';
/** Template 4 — field screen (mobile): the FieldScreen component is the template. */
export { decimalInput, FieldScreen, type FieldScreenProps } from '../components/FieldScreen';
export { DashboardTemplate, PanelList, type DashboardTemplateProps, type PanelItem } from './DashboardTemplate';
