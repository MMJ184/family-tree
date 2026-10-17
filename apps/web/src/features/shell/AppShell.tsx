import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
} from '@family-tree/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  Building2,
  ChevronsUpDown,
  Globe,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Moon,
  Network,
  RotateCcw,
  ShieldCheck,
  Sun,
  SunMoon,
  UserRoundCog,
  Users,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { resetDemoData } from '#/api/demo.ts';
import { useFamilies } from '#/entities/family/queries.ts';
import { canEdit, useLogout, useSession } from '#/entities/session/queries.ts';
import { familyName, initials } from '#/lib/display.ts';
import { type ThemeMode, usePrefs } from '#/lib/prefs.ts';

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="min-h-screen">
      <aside className="glass fixed inset-y-0 start-0 z-30 hidden w-[var(--sidebar-width)] flex-col border-y-0 border-s-0 md:flex">
        <Sidebar onNavigate={() => {}} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="start" className="flex w-[var(--sidebar-width)] flex-col p-0">
          <SheetTitle className="sr-only">{t('nav.openMenu')}</SheetTitle>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="md:ps-[var(--sidebar-width)]">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="min-h-[calc(100vh-var(--topbar-height))]">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { t, i18n } = useTranslation();
  const { data: session } = useSession();
  const { data: families } = useFamilies();
  const params = useParams({ strict: false }) as { familyId?: string };
  const familyId = params.familyId ?? families?.[0]?.family.id;
  const current = families?.find((f) => f.family.id === familyId);
  const isSuper = session?.user.isSuperAdmin ?? false;
  const admin = canEdit(current?.role ?? null);

  const items = familyId
    ? [
        { to: '/f/$familyId', label: t('nav.overview'), icon: LayoutDashboard, exact: true },
        { to: '/f/$familyId/tree', label: t('nav.tree'), icon: Network },
        { to: '/f/$familyId/people', label: t('nav.people'), icon: Users },
        { to: '/f/$familyId/businesses', label: t('nav.businesses'), icon: Building2 },
        ...(admin ? [{ to: '/f/$familyId/members', label: t('nav.members'), icon: ShieldCheck }] : []),
      ]
    : [];

  return (
    <div className="flex h-full flex-col">
      <Link
        to="/"
        onClick={onNavigate}
        className="flex h-[var(--topbar-height)] items-center gap-2.5 px-5 text-foreground no-underline"
      >
        <img src="/favicon.svg" alt="" className="size-8" />
        <span className="font-display text-lg font-bold">{t('appName')}</span>
      </Link>

      {/* The switcher appears only for users with more than one family (spec §2). */}
      {families && families.length > 1 && current && (
        <div className="px-3 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-start text-sm shadow-sm hover:bg-accent"
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: current.family.color }} />
                <span className="min-w-0 flex-1 truncate font-medium">{familyName(current.family, i18n.language)}</span>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[calc(var(--sidebar-width)-1.5rem)]">
              <DropdownMenuLabel>{t('nav.switchFamily')}</DropdownMenuLabel>
              {families.map((f) => (
                <DropdownMenuItem key={f.family.id} asChild>
                  <Link to="/f/$familyId" params={{ familyId: f.family.id }} onClick={onNavigate}>
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: f.family.color }} />
                    <span className="truncate">{familyName(f.family, i18n.language)}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {families && families.length === 1 && current && (
        <div className="flex items-center gap-2 px-5 pb-3 text-sm font-medium text-muted-foreground">
          <span className="size-2.5 rounded-full" style={{ background: current.family.color }} />
          <span className="truncate">{familyName(current.family, i18n.language)}</span>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {isSuper && (
          <NavItem to="/families" label={t('nav.allFamilies')} icon={Library} exact onNavigate={onNavigate} />
        )}
        {isSuper && items.length > 0 && <div className="my-2 h-px bg-border" />}
        {familyId &&
          items.map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              params={{ familyId }}
              label={item.label}
              icon={item.icon}
              exact={item.exact ?? false}
              onNavigate={onNavigate}
            />
          ))}
      </nav>

      {session && (
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
              {initials(session.user.name)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{session.user.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {t(`roles.${isSuper ? 'SUPER_ADMIN' : (current?.role ?? 'VIEWER')}`)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({
  to,
  params,
  label,
  icon: Icon,
  exact,
  onNavigate,
}: {
  to: string;
  params?: Record<string, string>;
  label: string;
  icon: typeof Users;
  exact: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={to}
      {...(params ? { params } : {})}
      onClick={onNavigate}
      activeOptions={{ exact, includeSearch: false }}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
    >
      <Icon className="size-4.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { t } = useTranslation();
  const { locale, setLocale, theme, setTheme } = usePrefs();
  const { data: session } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmReset, setConfirmReset] = useState(false);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : SunMoon;

  return (
    <header className="glass sticky top-0 z-20 flex h-[var(--topbar-height)] items-center gap-2 border-x-0 border-t-0 px-3 sm:px-5">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenu} aria-label={t('nav.openMenu')}>
        <Menu className="size-5" />
      </Button>
      <Badge variant="outline" className="border-gold/50 text-gold">
        {t('topbar.demoBadge')}
      </Badge>
      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
        aria-label={t('topbar.language')}
      >
        <Globe className="size-4" />
        <span>{locale === 'ar' ? t('topbar.english') : t('topbar.arabic')}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('topbar.theme')}>
            <ThemeIcon className="size-4.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
            <DropdownMenuRadioItem value="auto">{t('topbar.themeAuto')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">{t('topbar.themeLight')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">{t('topbar.themeDark')}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('topbar.account')}>
            <UserRoundCog className="size-4.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {session && (
            <DropdownMenuLabel className="font-normal text-muted-foreground">{session.user.email}</DropdownMenuLabel>
          )}
          <DropdownMenuItem onSelect={() => navigate({ to: '/login' })}>
            <Users className="size-4" />
            {t('topbar.switchUser')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmReset(true)}>
            <RotateCcw className="size-4" />
            {t('topbar.resetDemo')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => logout.mutate(undefined, { onSuccess: () => navigate({ to: '/login' }) })}
            className={cn('text-destructive-text')}
          >
            <LogOut className="size-4 rtl:-scale-x-100" />
            {t('topbar.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('topbar.resetConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('topbar.resetConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void resetDemoData().then(() => {
                  void qc.invalidateQueries();
                  toast.success(t('topbar.resetDone'));
                });
              }}
            >
              {t('actions.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
