import React from 'react';
import { Github, PlayCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

import Logo from '@/components/common/Logo';

const repositoryUrl = 'https://github.com/EP2-Git/project-s';

const Footer = () => (
  <footer className="border-t border-border bg-card px-4 py-8 sm:px-6 sm:py-12">
    <div className="container mx-auto">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-12">
        <div>
          <Logo className="mb-4" showBanner={true} size="lg" />
          <p className="mb-4 text-sm text-foreground/70">
            Apache-2.0 public pre-alpha scheduling software with an explicit
            human-authority boundary and database-enforced overlap protection.
          </p>
          <p className="text-sm text-foreground/60">
            Core 0.1.0-prealpha has no hosted service, billing product, or
            production-support guarantee.
          </p>
        </div>

        <div>
          <h3 className="mb-3 font-semibold sm:mb-4">Explore Core</h3>
          <ul className="space-y-2 sm:space-y-3">
            <li>
              <Link to="/demo" className="text-foreground/70 transition-colors hover:text-lavender">
                Authority demo
              </Link>
            </li>
            <li>
              <Link to="/features" className="text-foreground/70 transition-colors hover:text-lavender">
                Included and excluded features
              </Link>
            </li>
            <li>
              <Link to="/about" className="text-foreground/70 transition-colors hover:text-lavender">
                How the boundary works
              </Link>
            </li>
            <li>
              <a
                href={`${repositoryUrl}/blob/main/SECURITY.md`}
                className="text-foreground/70 transition-colors hover:text-lavender"
              >
                Security policy
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="mb-3 font-semibold sm:mb-4">Evaluate the source</h3>
          <p className="mb-4 text-sm text-foreground/70">
            Run the joined MCP, browser, database, replay, and authenticated-host
            cancellation proof against synthetic local data.
          </p>
          <div className="flex flex-col items-start gap-3 sm:flex-row">
            <Link
              to="/demo"
              className="inline-flex h-11 items-center rounded-md bg-lavender px-4 py-2 font-medium text-white transition-colors hover:bg-lavender-light"
            >
              <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              Review demo
            </Link>
            <a
              href={repositoryUrl}
              className="inline-flex h-11 items-center rounded-md border border-border px-4 py-2 font-medium text-foreground/80 transition-colors hover:border-lavender hover:text-lavender"
            >
              <Github className="mr-2 h-4 w-4" aria-hidden="true" />
              View source
            </a>
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-border pt-6 sm:mt-12 sm:pt-8 md:flex-row">
        <p className="text-sm text-foreground/60">
          &copy; {new Date().getFullYear()} Project S contributors. Source licensed Apache-2.0.
        </p>
        <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
          <Link to="/privacy" className="text-sm text-foreground/60 hover:text-lavender">
            Operator privacy template
          </Link>
          <Link to="/terms" className="text-sm text-foreground/60 hover:text-lavender">
            Operator terms template
          </Link>
        </div>
      </div>
    </div>
  </footer>
);

export default Footer;
