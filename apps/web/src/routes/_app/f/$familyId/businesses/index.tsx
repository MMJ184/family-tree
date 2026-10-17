import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { BusinessDirectory, type DirectorySearch, directorySearch } from '#/features/businesses/index.ts';

export const Route = createFileRoute('/_app/f/$familyId/businesses/')({
  validateSearch: directorySearch,
  component: BusinessesPage,
  errorComponent: ({ error, reset }) => <ErrorState error={error} reset={reset} />,
});

function BusinessesPage() {
  const { familyId } = Route.useParams();
  const { role } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const onSearch = useCallback(
    (patch: Partial<DirectorySearch>) => void navigate({ search: (s) => ({ ...s, ...patch }), replace: true }),
    [navigate],
  );
  return <BusinessDirectory familyId={familyId} role={role} search={search} onSearch={onSearch} />;
}
