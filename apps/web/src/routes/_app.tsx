import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { sessionQuery } from '#/entities/session/queries.ts';
import { AppShell } from '#/features/shell/AppShell.tsx';

/** Everything behind sign-in. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session) throw redirect({ to: '/login', search: { redirect: location.href } });
    return { session };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
