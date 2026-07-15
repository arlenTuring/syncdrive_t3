import { TimeTemplateListPage } from './components/TimeTemplateListPage';

type TimeTemplatesAppProps = {
  onBackToHome?: () => void;
  embedded?: boolean;
};

export default function TimeTemplatesApp({ onBackToHome, embedded }: TimeTemplatesAppProps) {
  return <TimeTemplateListPage onBackToHome={embedded ? undefined : onBackToHome} />;
}
