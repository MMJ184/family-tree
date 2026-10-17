import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { useFamilyGraph } from '#/entities/family/queries.ts';
import { PeopleList } from '#/features/people/PeopleList.tsx';

export const Route = createFileRoute('/_app/f/$familyId/people/')({
  component: PeoplePage,
  errorComponent: ({ error, reset }) => <ErrorState error={error} reset={reset} />,
});

function PeoplePage() {
  const { familyId } = Route.useParams();
  const navigate = useNavigate();
  const { data: graph, isPending, error } = useFamilyGraph(familyId);
  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  return (
    <PeopleList
      graph={graph}
      onAdded={(personId) => void navigate({ to: '/f/$familyId/people/$personId', params: { familyId, personId } })}
    />
  );
}
