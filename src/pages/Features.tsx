
import React, { useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Calendar, Clock, Globe, Smartphone, Cloud, MessageCircle, Bell, Brain, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  excluded?: boolean;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description, excluded = false }) => (
  <div className="border border-border rounded-xl p-6 bg-card hover:border-lavender/50 transition-all">
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between mb-4">
        <div className="h-12 w-12 rounded-lg bg-lavender/20 flex items-center justify-center text-lavender">
          {icon}
        </div>
        {excluded && (
          <Badge variant="outline" className="bg-lavender/10 text-lavender border-lavender/30">
            Not implemented · no release date
          </Badge>
        )}
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-foreground/70 text-sm flex-grow">{description}</p>
    </div>
  </div>
);

const Features = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = "Features | Project S Core Pre-Alpha";

    // Create or update meta tags
    const metaTags = [
      { name: "description", content: "Explore the deterministic scheduling core included in Project S Core 0.1.0-prealpha and its explicit feature boundaries." },
      { property: "og:title", content: "Project S Core Pre-Alpha Features" },
      { property: "og:description", content: "Self-hosted booking pages, server-generated availability, human confirmation, and database-authoritative creation." },
      { property: "og:type", content: "website" }
    ];

    metaTags.forEach(meta => {
      let element = document.querySelector(`meta[${meta.name ? 'name' : 'property'}="${meta.name || meta.property}"]`);
      if (!element) {
        element = document.createElement('meta');
        if (meta.name) element.setAttribute('name', meta.name);
        if (meta.property) element.setAttribute('property', meta.property);
        document.head.appendChild(element);
      }
      element.setAttribute('content', meta.content);
    });
  }, []);

  const includedFeatures = [
    {
      icon: <Calendar className="h-6 w-6" />,
      title: "Public Booking Pages",
      description: "Share meeting types and let guests select server-generated available times."
    },
    {
      icon: <Clock className="h-6 w-6" />,
      title: "Weekly Availability",
      description: "Set your recurring availability with custom hours for each day of the week."
    },
    {
      icon: <Globe className="h-6 w-6" />,
      title: "Explicit Time-Zone Selection",
      description: "Guests can choose an IANA display time zone while booking."
    },
    {
      icon: <ShieldCheck className="h-6 w-6" />,
      title: "Database-Authoritative Creation",
      description: "PostgreSQL rechecks the current slot under the host lock and enforces the overlap constraint before insertion."
    },
    {
      icon: <Smartphone className="h-6 w-6" />,
      title: "Selected Responsive States",
      description: "The authority review and selected public states are checked at defined mobile and reflow widths in browser CI."
    }
  ];

  const excludedCapabilities = [
    {
      icon: <Calendar className="h-6 w-6" />,
      title: "Calendar Integrations",
      description: "No Google or other calendar provider ships in Core. A future adapter requires its own authorization, privacy, and contract review.",
      excluded: true
    },
    {
      icon: <Bell className="h-6 w-6" />,
      title: "Outbound Notifications",
      description: "No email, SMS, or messaging provider ships in Core.",
      excluded: true
    },
    {
      icon: <Brain className="h-6 w-6" />,
      title: "Model-Assisted Interpretation",
      description: "No AI runtime ships in Core. Future model assistance cannot become scheduling authority.",
      excluded: true
    },
    {
      icon: <MessageCircle className="h-6 w-6" />,
      title: "Guest Cancellation or Rescheduling",
      description: "No public guest mutation tool ships. Cancellation remains an authenticated host action.",
      excluded: true
    },
    {
      icon: <Cloud className="h-6 w-6" />,
      title: "Managed Project S Cloud",
      description: "Planned private operating model only. No public signup, billing, SLA, or deployed service is available.",
      excluded: true
    }
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1 pt-32">
        {/* Hero Section */}
        <section className="py-16 px-6">
          <div className="container mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">A focused, self-hostable scheduling core</h1>
            <p className="text-xl text-foreground/70 max-w-3xl mx-auto mb-12">
              See what Project S Core 0.1.0-prealpha includes and which integrations remain outside this baseline.
            </p>
          </div>
        </section>

        {/* Included baseline section */}
        <section className="py-12 px-6 bg-background/50">
          <div className="container mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold mb-3">Included Core pre-alpha capabilities</h2>
              <p className="text-foreground/70 max-w-2xl mx-auto">The current implementation is limited to the scheduling capabilities listed here.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {includedFeatures.map((feature, index) => (
                <FeatureCard
                  key={index}
                  icon={feature.icon}
                  title={feature.title}
                  description={feature.description}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Excluded roadmap section */}
        <section className="py-12 px-6">
          <div className="container mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold mb-3">Explicit exclusions, not release promises</h2>
              <p className="text-foreground/70 max-w-2xl mx-auto">These capabilities are not implemented in this release and have no committed availability date.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {excludedCapabilities.map((feature, index) => (
                <FeatureCard
                  key={index}
                  icon={feature.icon}
                  title={feature.title}
                  description={feature.description}
                  excluded={feature.excluded}
                />
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 px-6 text-center">
          <div className="container mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6">Want to try it yourself?</h2>
            <Link to="/demo">
              <Button size="lg" className="bg-lavender hover:bg-lavender-light">
                See a Demo
              </Button>
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Features;
