import { createFileRoute } from '@tanstack/react-router';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { PersonProfile } from '#/features/people/PersonProfile.tsx';

export const Route = createFileRoute('/_app/f/$familyId/people/$personId')({
  component: PersonPage,
  errorComponent: ({ error, reset }) => <ErrorState error={error} reset={reset} />,
});

function PersonPage() {
  const { familyId, personId } = Route.useParams();
  return <PersonProfile key={personId} familyId={familyId} personId={personId} />;
}
