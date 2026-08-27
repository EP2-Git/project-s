import React, { useEffect } from 'react';
import { ArrowRight, Calendar, Clock, Github, PlayCircle, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/button';

const About: React.FC = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = 'About | Project S Core Pre-Alpha';

    const metaTags = [
      {
        name: 'description',
        content: 'Learn about Project S, a focused self-hostable scheduling application with an explicit booking authority boundary.',
      },
      { property: 'og:title', content: 'About Project S Core Pre-Alpha' },
      {
        property: 'og:description',
        content: 'Project S Core 0.1.0-prealpha separates booking preparation, human authority, and database-authoritative creation.',
      },
      { property: 'og:type', content: 'website' },
    ];

    metaTags.forEach((meta) => {
      const selector = `meta[${meta.name ? 'name' : 'property'}="${meta.name || meta.property}"]`;
      let element = document.querySelector(selector);
      if (!element) {
        element = document.createElement('meta');
        if (meta.name) element.setAttribute('name', meta.name);
        if (meta.property) element.setAttribute('property', meta.property);
        document.head.appendChild(element);
      }
      element.setAttribute('content', meta.content);
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Navbar />
      <main className="flex-1 pt-32">
        <section className="px-6 py-16 text-center">
          <div className="container mx-auto">
            <h1 className="mb-4 text-4xl font-bold md:text-5xl">Built to make booking authority inspectable</h1>
            <p className="mx-auto max-w-3xl text-xl text-foreground/70">
              Project S is a self-hostable scheduling application focused on a clear, server-authoritative booking path.
            </p>
          </div>
        </section>

        <section className="px-6 py-12">
          <div className="container mx-auto flex max-w-4xl flex-col items-center gap-12 md:flex-row">
            <div className="flex-1">
              <h2 className="mb-6 text-3xl font-bold">The goal</h2>
              <p className="mb-6 text-lg text-foreground/80">
                Hosts publish scheduling policy and guests receive server-generated
                choices. Because availability can change after display or preparation,
                Project S rechecks it under the host lock before creation.
              </p>
              <p className="text-lg text-foreground/80">
                Project S keeps free-slot calculation and final conflict checks on the server while presenting dates and times in an explicit guest-selected time zone.
              </p>
            </div>
            <div className="flex h-64 w-64 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-lavender to-lavender-dark/70">
              <Calendar className="h-24 w-24 text-white opacity-90" aria-hidden="true" />
            </div>
          </div>
        </section>

        <section className="bg-background/50 px-6 py-12">
          <div className="container mx-auto max-w-4xl">
            <h2 className="mb-12 text-center text-3xl font-bold">V1 candidate principles</h2>
            <div className="grid gap-8 md:grid-cols-3">
              <article className="rounded-xl border border-border bg-card p-8 text-center">
                <ShieldCheck className="mx-auto mb-5 h-10 w-10 text-lavender" aria-hidden="true" />
                <h3 className="mb-3 text-xl font-semibold">Server authority</h3>
                <p className="text-foreground/70">The browser never derives the final availability or booking duration.</p>
              </article>
              <article className="rounded-xl border border-border bg-card p-8 text-center">
                <Clock className="mx-auto mb-5 h-10 w-10 text-lavender" aria-hidden="true" />
                <h3 className="mb-3 text-xl font-semibold">Explicit time zones</h3>
                <p className="text-foreground/70">Hosts keep a scheduling zone and guests choose the zone used for display.</p>
              </article>
              <article className="rounded-xl border border-border bg-card p-8 text-center">
                <ArrowRight className="mx-auto mb-5 h-10 w-10 text-lavender" aria-hidden="true" />
                <h3 className="mb-3 text-xl font-semibold">Honest boundaries</h3>
                <p className="text-foreground/70">Calendar sync, outbound notifications, and AI assistance are not included in this candidate.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="px-6 py-16 text-center">
          <div className="container mx-auto max-w-3xl">
            <h2 className="mb-4 text-2xl font-bold md:text-3xl">Operator-owned by design</h2>
            <p className="mb-8 text-lg text-foreground/70">
              Project S Core is source software, not a hosted service. Each deployment
              administrator owns accounts, support, privacy notices, and data requests.
            </p>
            <Button asChild size="lg" variant="outline">
              <a href="https://github.com/EP2-Git/project-s/blob/main/docs/self-hosting.md">
                <Github className="mr-2 h-5 w-5" aria-hidden="true" />
                Read the self-hosting guide
              </a>
            </Button>
          </div>
        </section>

        <section className="bg-background/50 px-6 py-16 text-center">
          <div className="container mx-auto max-w-3xl">
            <h2 className="mb-4 text-2xl font-bold md:text-3xl">Inspect the real boundary</h2>
            <p className="mb-8 text-lg text-foreground/70">
              Follow the deterministic MCP-to-browser demo, including refusal,
              confirmation, locked commit, exact replay, and authenticated host cancellation.
            </p>
            <Button asChild size="lg" className="bg-lavender hover:bg-lavender-light">
              <Link to="/demo">
                <PlayCircle className="mr-2 h-5 w-5" aria-hidden="true" />
                Review the authority demo
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default About;
