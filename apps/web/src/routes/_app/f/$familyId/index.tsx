import { createFileRoute } from '@tanstack/react-router';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { useFamilyGraph } from '#/entities/family/queries.ts';
import { canEdit } from '#/entities/session/queries.ts';
import { EditFamilyButton } from '#/features/families/index.ts';
import { FamilyOverview } from '#/features/overview/index.ts';

/** A family's home: overview dashboard. Admins also get "Edit family" in the hero. */
export const Route = createFileRoute('/_app/f/$familyId/')({
  component: FamilyOverviewRoute,
  errorComponent: ({ error, reset }) => <ErrorState error={error} reset={reset} />,
});

function FamilyOverviewRoute() {
  const { familyId } = Route.useParams();
  const { role } = Route.useRouteContext();
  const { data: graph, isPending, error } = useFamilyGraph(familyId);
  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  return (
    <FamilyOverview
      graph={graph}
      {...(canEdit(role) ? { heroActions: <EditFamilyButton family={graph.family} /> } : {})}
    />
  );
}
