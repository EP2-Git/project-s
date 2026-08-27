
import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import Container from '@/components/ui/container';
import DeploymentFooter from '@/components/deployment/DeploymentFooter';
import { Button } from '@/components/ui/button';
import DeploymentHeader from '@/components/deployment/DeploymentHeader';

const PrivacyPolicy = () => {
  // Set document title and scroll to top on component mount
  useEffect(() => {
    document.title = "Privacy Policy | Project S";
    window.scrollTo(0, 0);

    // Add meta description
    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.setAttribute('name', 'description');
      document.head.appendChild(metaDescription);
    }
    metaDescription.setAttribute('content', 'Review the privacy template for operators of a self-hosted Project S deployment.');
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <DeploymentHeader />
      <main className="flex-1 py-12">
        <Container className="max-w-3xl">
          <div className="sticky top-4 z-10 mb-8 flex">
            <Button
              variant="outline"
              size="sm"
              className="group flex items-center gap-1"
              asChild
            >
              <Link to="/">
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                Back to Home
              </Link>
            </Button>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold mb-8">Privacy Policy</h1>

          <div className="space-y-10">
            <section className="prose prose-sm sm:prose dark:prose-invert max-w-none">
              <p className="text-muted-foreground">
                Last updated: August 26, 2026
              </p>

              <p>
                Project S Core 0.1.0-prealpha is self-hostable open-source software, not a centrally operated hosted service. The operator of the deployment you use is responsible for its privacy policy and data practices. This page is a self-hosting template and must be adapted by each operator.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">1. Information We Collect</h2>
              <p>The application stores the following types of information in its configured Supabase backend:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Authentication data:</strong> Email address and authentication credentials are processed by the configured Supabase Auth service. Project S application tables do not store your password.</li>
                <li><strong>Profile and scheduling data:</strong> Full name, username, host time zone, meeting types, weekly availability, and specific-date overrides.</li>
                <li><strong>Booking data:</strong> Meeting type, start and end time, guest name, guest email, guest time zone, optional notes, status, and internal conflict/idempotency metadata.</li>
                <li><strong>Confirmation challenge data, when enabled:</strong> Cloudflare Turnstile processes browser, device, and network signals. Project S sends the challenge token, a random verification retry identifier, and—when trusted proxy handling is enabled—the visitor IP address to Cloudflare for server-side verification.</li>
              </ul>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">2. How We Use Your Data</h2>
              <p>Core 0.1.0-prealpha uses this information for the following purposes:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Authenticate hosts and protect dashboard data</li>
                <li>Calculate public free slots without exposing raw host rules or bookings</li>
                <li>Create, display, and let a host cancel bookings</li>
                <li>Verify a human confirmation challenge before committing a public booking when Turnstile is configured</li>
              </ul>
              <p>Core 0.1.0-prealpha does not include analytics, advertising trackers, calendar-provider sync, or outbound booking notifications.</p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">3. Cookies</h2>
              <p>
                The configured Supabase client uses browser storage to maintain an authenticated session. Core does not add analytics cookies. When Turnstile is enabled, Cloudflare may process strictly necessary signals or cookies for bot detection under its own privacy terms. A deployment operator or hosting provider may add other logging, cookies, or services and must disclose them separately.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">4. Third-Party Services</h2>
              <p>The application connects to the Supabase URL configured by the deployment operator:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Supabase:</strong> For user authentication and database services</li>
                <li><strong>Cloudflare Turnstile, when configured:</strong> For the human-confirmation bot challenge. Project S does not send guest names, email addresses, notes, meeting times, or other booking form entries to Turnstile's verification API.</li>
              </ul>
              <p>The operator decides whether the backend is self-hosted or provided by a third party and is responsible for the applicable terms and privacy disclosures. See Cloudflare's Turnstile Privacy Addendum for its current signal-processing details.</p>


              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">5. Data Retention</h2>
              <p>
                Core 0.1.0-prealpha does not implement an automated retention schedule, self-service account deletion, or data export. Data remains in the configured backend until the deployment operator deletes or retains it under their own policy. Cancelling a booking changes its status; it does not erase the booking record.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">6. Your Rights</h2>
              <p>Depending on your location, applicable law may give you rights to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Ask the deployment operator for access to personal information it holds about you</li>
                <li>Ask the deployment operator to correct inaccurate information</li>
                <li>Ask the deployment operator to delete your personal information</li>
                <li>Object to or restrict certain processing of your data</li>
                <li>Request a copy of your data in a portable format</li>
              </ul>
              <p>
                Core 0.1.0-prealpha does not automate these requests. Contact the deployment operator to ask how a request is verified and fulfilled.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">7. Contact the Operator</h2>
              <p>
                If you have questions about data practices or want to exercise your
                rights, contact the administrator of the Project S deployment you use.
              </p>
            </section>
          </div>
        </Container>
      </main>
      <DeploymentFooter />
    </div>
  );
};

export default PrivacyPolicy;
