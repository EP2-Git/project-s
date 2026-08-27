
import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import Container from '@/components/ui/container';
import DeploymentFooter from '@/components/deployment/DeploymentFooter';
import { Button } from '@/components/ui/button';
import DeploymentHeader from '@/components/deployment/DeploymentHeader';

const TermsOfService = () => {
  // Set document title and scroll to top on component mount
  useEffect(() => {
    document.title = "Terms of Service | Project S";
    window.scrollTo(0, 0);

    // Add meta description
    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.setAttribute('name', 'description');
      document.head.appendChild(metaDescription);
    }
    metaDescription.setAttribute('content', 'Read the terms and conditions for operating or using a Project S scheduling deployment.');
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

          <h1 className="text-3xl sm:text-4xl font-bold mb-8">Terms of Service</h1>

          <div className="space-y-10">
            <section className="prose prose-sm sm:prose dark:prose-invert max-w-none">
              <p className="text-muted-foreground">
                Last updated: August 26, 2026
              </p>

              <p>
                Project S Core 0.1.0-prealpha is self-hostable software distributed under Apache-2.0, not a centrally operated hosted service. These terms are a self-hosting reference notice and not legal advice. Each deployment operator must publish terms appropriate to their service and jurisdiction.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">1. Acceptance of Terms</h2>
              <p>
                Your agreement for a hosted Project S instance is with that deployment operator. Do not use an instance if you do not accept the operator's terms and privacy policy.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">2. Description of Service</h2>
              <p>
                Project S is a scheduling application that allows users to create booking pages, set availability, and manage appointments. Calendar-provider sync, outbound booking notifications, and AI assistance are not included in Core 0.1.0-prealpha.
              </p>
              <p>
                Core includes persisted public request limits and a reference Turnstile confirmation integration. Each deployment operator remains responsible for correctly configuring and validating its HTTPS, proxy, origin, hostname, secret, challenge, monitoring, and capacity boundaries before serving public traffic.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">3. Account Responsibilities</h2>
              <p>When using a Project S deployment, you should:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide accurate and complete information when creating your account</li>
                <li>Maintain the security of your account and password</li>
                <li>Notify the deployment operator of suspected unauthorized access</li>
                <li>Take responsibility for all activities that occur under your account</li>
                <li>Not use the service for any illegal or unauthorized purpose</li>
                <li>Not attempt to interfere with the proper functioning of the service</li>
              </ul>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">4. Limitation of Liability</h2>
              <p>
                Core 0.1.0-prealpha is provided for evaluation under Apache-2.0 on an “AS IS” basis, without warranties or conditions except where required by law. A deployment operator is responsible for any separate service warranty it offers, including:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Any responsibility for missed meetings or scheduling errors</li>
                <li>Service interruptions, bugs, or technical issues</li>
                <li>Accuracy or availability of third-party infrastructure selected by a deployment operator</li>
                <li>Availability or reliability of the service, especially while this candidate is being evaluated</li>
              </ul>
              <p>
                Liability for a hosted instance is governed by the operator's terms and applicable law.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">5. Changes to the Service</h2>
              <p>
                A deployment operator may modify, suspend, or discontinue their hosted service. The public pre-alpha may also change between revisions without compatibility guarantees.
              </p>
              <p>
                Operators should notify their users when their hosted-service terms materially change.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">6. Termination</h2>
              <p>
                Core 0.1.0-prealpha has no self-service account deletion. Contact the deployment operator about account closure, deletion, or retention.
              </p>
              <p>
                A deployment operator determines when access to its hosted instance may be suspended or terminated.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">7. Governing Law</h2>
              <p>
                The deployment operator must state the law and venue governing its hosted service. The Project S repository does not impose a jurisdiction on independent deployments.
              </p>

              <h2 className="text-xl sm:text-2xl font-semibold mt-8 mb-4">8. Contact</h2>
              <p>
                Questions about these terms should be directed to the administrator
                of the Project S deployment you use.
              </p>
            </section>
          </div>
        </Container>
      </main>
      <DeploymentFooter />
    </div>
  );
};

export default TermsOfService;
