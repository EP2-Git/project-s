import { useEffect } from 'react';
import {
  Bot,
  CheckCircle2,
  Database,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  TerminalSquare,
  UserCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import DeploymentHeader from '@/components/deployment/DeploymentHeader';
import DeploymentFooter from '@/components/deployment/DeploymentFooter';
import Container from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DemoStep {
  title: string;
  description: string;
  icon: LucideIcon;
}

const demoSteps: DemoStep[] = [
  {
    title: 'Agent discovers and prepares',
    description:
      'The local MCP client calls Project S’s real public contracts to find a current slot and prepare one exact booking intent. Preparation does not hold the time.',
    icon: Bot,
  },
  {
    title: 'Create is refused',
    description:
      'The client immediately tries to create the booking. Project S returns CONFIRMATION_REQUIRED, and the database contains no booking for the prepared request.',
    icon: LockKeyhole,
  },
  {
    title: 'A person reviews the request',
    description:
      'Project S opens the private browser review. The person sees the server-derived host, meeting, time zones, and guest details, then explicitly approves them.',
    icon: UserCheck,
  },
  {
    title: 'Database authority commits',
    description:
      'The client retries create. Under the host lock, Project S rechecks the current clock, policy, availability, confirmation grant, and overlap constraint before inserting.',
    icon: Database,
  },
  {
    title: 'The same retry stays singular',
    description:
      'Replaying the identical preparation token and idempotency key returns the original booking result instead of creating a duplicate.',
    icon: RefreshCcw,
  },
  {
    title: 'The host cancels through its contract',
    description:
      'The seeded host authenticates and cancels the committed booking with the implemented version-checked host contract.',
    icon: CheckCircle2,
  },
];

const Demo = () => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Authority Boundary Demo | Project S';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <DeploymentHeader />
      <main className="flex-1">
        <Container>
          <section className="mx-auto max-w-4xl py-14 text-center sm:py-20">
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-foreground">
              Real local contracts · fictional fixture
            </Badge>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Authority Boundary Demo
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
              A deterministic MCP client can use Project S’s scheduling contracts, but it does not silently gain more authority than a person. The client may discover and prepare; a person must review and approve; the database remains the final authority. This demonstration does not run a model.
            </p>
          </section>

          <section aria-labelledby="run-demo-title" className="mx-auto max-w-5xl pb-12">
            <Card className="overflow-hidden border-primary/30 bg-primary/5 shadow-md">
              <CardHeader className="border-b border-primary/20">
                <div className="flex items-start gap-3">
                  <TerminalSquare className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <h2
                      id="run-demo-title"
                      className="text-2xl font-semibold leading-none tracking-tight"
                    >
                      Run the real flow
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      From a bootstrapped local Project S checkout, use the seeded <code>demo-host</code>. The interactive command pauses for the browser approval; it does not approve on the person’s behalf.
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
                <div className="min-w-0 rounded-lg border bg-background/80 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Interactive demonstration
                  </p>
                  <code className="mt-3 block overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-3 text-sm text-foreground">
                    npm run demo:authority
                  </code>
                </div>
                <div className="min-w-0 rounded-lg border bg-background/80 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Reproducible local captures
                  </p>
                  <code className="mt-3 block overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-3 text-sm text-foreground">
                    npm run demo:authority:capture
                  </code>
                </div>
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="flow-title" className="mx-auto max-w-5xl py-12">
            <div className="max-w-3xl">
              <p className="text-sm font-medium text-muted-foreground">One prepared intent, three authorities</p>
              <h2 id="flow-title" className="mt-2 text-3xl font-semibold">
                What the demonstration actually does
              </h2>
              <p className="mt-3 leading-7 text-muted-foreground">
                Every state below comes from the real MCP, HTTP, browser, and PostgreSQL paths. The page does not animate or fabricate their outcomes.
              </p>
            </div>

            <ol className="mt-8 grid gap-4 md:grid-cols-2">
              {demoSteps.map((step, index) => {
                const StepIcon = step.icon;
                return (
                  <li key={step.title} className="rounded-xl border bg-card p-5 shadow-sm">
                    <div className="flex items-start gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <StepIcon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Step {index + 1}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-labelledby="authority-title" className="mx-auto max-w-5xl py-12">
            <h2 id="authority-title" className="text-3xl font-semibold">
              The boundary at a glance
            </h2>
            <div className="mt-6 grid gap-5 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <Bot className="h-7 w-7 text-primary" aria-hidden="true" />
                  <CardTitle className="pt-2 text-xl">Agent authority</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
                  <p>Discover public availability.</p>
                  <p>Prepare one exact booking intent.</p>
                  <p>Request commit and safely repeat the same request.</p>
                </CardContent>
              </Card>
              <Card className="border-primary/30">
                <CardHeader>
                  <ShieldCheck className="h-7 w-7 text-primary" aria-hidden="true" />
                  <CardTitle className="pt-2 text-xl">Human authority</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
                  <p>See the exact server-derived request in the browser.</p>
                  <p>Accept the notice and complete the configured challenge.</p>
                  <p>Explicitly approve this preparation—not a conversational summary.</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <Database className="h-7 w-7 text-primary" aria-hidden="true" />
                  <CardTitle className="pt-2 text-xl">Database authority</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
                  <p>Re-read the current clock, policy, and schedule under the host lock.</p>
                  <p>Validate the bound one-use confirmation grant.</p>
                  <p>Enforce overlap and idempotency constraints at commit.</p>
                </CardContent>
              </Card>
            </div>
          </section>

          <section aria-labelledby="limits-title" className="mx-auto max-w-5xl py-12 pb-20">
            <h2 id="limits-title" className="text-3xl font-semibold">
              What it proves—and what it does not
            </h2>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />
                  <h3 className="text-xl font-semibold">It proves</h3>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  The public MCP contract cannot create an unapproved preparation, approval does not reserve a slot, final scheduling checks remain deterministic, and an identical retry does not duplicate the booking.
                </p>
              </div>
              <div className="rounded-xl border p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <XCircle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  <h3 className="text-xl font-semibold">It does not prove</h3>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  The fictional loopback fixture is not a production deployment, identity check, email-ownership check, performance claim, or proof of production Turnstile configuration. It demonstrates Project S’s authority boundaries, not model reasoning.
                </p>
              </div>
            </div>
          </section>
        </Container>
      </main>
      <DeploymentFooter />
    </div>
  );
};

export default Demo;
