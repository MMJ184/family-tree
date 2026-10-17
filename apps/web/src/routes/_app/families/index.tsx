import { createFileRoute } from '@tanstack/react-router';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { NotFound } from '#/components/shared/NotFound.tsx';
import { FamiliesPage } from '#/features/families/index.ts';

/** Super Admin's family list. Anyone else gets a plain not-found page, with no hint that it exists. */
export const Route = createFileRoute('/_app/families/')({
  component: FamiliesRoute,
  errorComponent: ({ error, reset }) => <ErrorState error={error} reset={reset} />,
});

function FamiliesRoute() {
  const { session } = Route.useRouteContext();
  if (!session.user.isSuperAdmin) return <NotFound />;
  return <FamiliesPage clientName={session.client.name} />;
}
