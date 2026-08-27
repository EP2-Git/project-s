import React from 'react';
import { Calendar, Check, Clock, Globe2, Minus, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const includedFeatures = [
  {
    title: 'Public booking pages',
    description: 'Share meeting types and let guests choose a date and available time.',
    icon: Calendar,
  },
  {
    title: 'Server-generated free slots',
    description: 'Availability is calculated by the scheduling service, not reconstructed in the browser.',
    icon: Clock,
  },
  {
    title: 'Database-enforced overlap protection',
    description: 'PostgreSQL rechecks the slot under the host lock and enforces its overlap constraint before insertion.',
    icon: ShieldCheck,
  },
  {
    title: 'Time-zone-aware booking',
    description: 'Guests can choose an IANA time zone while the host keeps a canonical scheduling zone.',
    icon: Globe2,
  },
];

const boundaries = [
  ['Core booking pages and availability', true],
  ['Database-authoritative booking creation', true],
  ['Persisted public request throttling', true],
  ['Turnstile confirmation integration (when configured)', true],
  ['Google or other calendar sync', false],
  ['Booking email notifications', false],
  ['AI booking assistant', false],
] as const;

const FeaturesSection: React.FC = () => (
  <section className="px-6 py-20" id="features">
    <div className="container mx-auto">
      <div className="mx-auto mb-12 max-w-3xl text-center">
        <h2 className="mb-4 text-3xl font-bold md:text-4xl">Scheduling you can self-host</h2>
        <p className="text-lg text-foreground/80">
          Project S Core pre-alpha focuses on a small, server-authoritative booking core with explicit product boundaries.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {includedFeatures.map((feature) => (
          <article key={feature.title} className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-lavender/20">
                <feature.icon className="h-6 w-6 text-lavender" aria-hidden="true" />
              </div>
              <Badge variant="outline">Included in Core pre-alpha</Badge>
            </div>
            <h3 className="mb-2 text-xl font-semibold">{feature.title}</h3>
            <p className="text-foreground/70">{feature.description}</p>
          </article>
        ))}
      </div>

      <div className="mt-16 overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border p-6">
          <h3 className="text-2xl font-bold">Core pre-alpha feature boundary</h3>
          <p className="mt-2 text-foreground/70">
            Calendar integrations, outbound notifications, and AI assistance are not part of Core pre-alpha.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            The reference boundary includes persisted limits for public operations and browser support routes, plus Turnstile confirmation when configured. Operators must still configure and verify HTTPS, proxy-header handling, origins, hostnames, secrets, and challenge behavior before serving public traffic.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">Features included and excluded from Project S Core pre-alpha</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-6 py-4 text-left">Capability</th>
                <th scope="col" className="px-6 py-4 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {boundaries.map(([name, included]) => (
                <tr key={name} className="border-b border-border last:border-0">
                  <th scope="row" className="px-6 py-4 text-left font-medium">{name}</th>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-2">
                      {included ? (
                        <Check className="h-5 w-5 text-green-500" aria-hidden="true" />
                      ) : (
                        <Minus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                      )}
                      {included ? 'Included' : 'Not included'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
);

export default FeaturesSection;
