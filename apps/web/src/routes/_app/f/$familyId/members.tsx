import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { NotFound } from '#/components/shared/NotFound.tsx';
import { useFamilyGraph } from '#/entities/family/queries.ts';
import { canEdit } from '#/entities/session/queries.ts';
import { MembersPage } from '#/features/members/index.ts';
import { familyName } from '#/lib/display.ts';

/** The family's access list. Only its admins and Super Admin; Viewers get a not-found page. */
export const Route = createFileRoute('/_app/f/$familyId/members')({
  component: MembersRoute,
  errorComponent: ({ error, reset }) => <ErrorState error={error} reset={reset} />,
});

function MembersRoute() {
  const { familyId } = Route.useParams();
  const { role } = Route.useRouteContext();
  const { i18n } = useTranslation();
  const graph = useFamilyGraph(familyId);
  if (!role || !canEdit(role)) return <NotFound />;
  if (graph.isPending) return <LoadingState />;
  if (graph.error) return <ErrorState error={graph.error} />;
  return (
    <MembersPage
      familyId={familyId}
      familyLabel={familyName(graph.data.family, i18n.language)}
      familyColor={graph.data.family.color}
      myRole={role}
    />
  );
}
