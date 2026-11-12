import { Navigate, useSearchParams } from 'react-router-dom';
import { adminPath, isAdminSection } from '../admin/adminSections';

/** The control room moved into the administration (admin UX review, 12 November 2026). Old links keep working. */
export default function DevPage() {
  const [params] = useSearchParams();
  const requested = params.get('section') ?? 'questions';
  return <Navigate to={adminPath(isAdminSection(requested) ? requested : 'questions')} replace />;
}
