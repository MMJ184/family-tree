import { createFileRoute } from '@tanstack/react-router';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { businessQuery } from '#/entities/business/queries.ts';
import { BusinessDetail } from '#/features/businesses/index.ts';

export const Route = createFileRoute('/_app/f/$familyId/businesses/$businessId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(businessQuery(params.familyId, params.businessId)),
  component: BusinessPage,
  errorComponent: ({ error, reset }) => <ErrorState error={error} reset={reset} />,
});

function BusinessPage() {
  const { familyId, businessId } = Route.useParams();
  const { role } = Route.useRouteContext();
  return <BusinessDetail familyId={familyId} businessId={businessId} role={role} />;
}
