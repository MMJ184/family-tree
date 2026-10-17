import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { familyGraphQuery } from '#/entities/family/queries.ts';
import { roleForFamily } from '#/entities/session/queries.ts';

/** A family's pages. Loads the family graph once; it 404s when the user has no access. */
export const Route = createFileRoute('/_app/f/$familyId')({
  beforeLoad: ({ context, params }) => ({ role: roleForFamily(context.session, params.familyId) }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(familyGraphQuery(params.familyId)),
  component: Outlet,
  errorComponent: ({ error, reset }) => <ErrorState error={error} reset={reset} />,
});
