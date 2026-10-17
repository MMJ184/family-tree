import { createFileRoute, redirect } from '@tanstack/react-router';
import { NoFamily } from '#/features/families/index.ts';

/** Super Admin lands on the family list; everyone else on their (first) family, or an empty state. */
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    const { session } = context;
    if (session.user.isSuperAdmin) throw redirect({ to: '/families' });
    const first = session.families[0];
    if (first) throw redirect({ to: '/f/$familyId', params: { familyId: first.familyId } });
  },
  component: NoFamily,
});
