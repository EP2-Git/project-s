
import React, { useEffect } from 'react';
import Navbar from '@/components/Navbar';
import HeroSection from '@/components/HeroSection';
import FeaturesSection from '@/components/FeaturesSection';
import Footer from '@/components/Footer';

const Index = () => {
  // Set dark mode as default
  useEffect(() => {
    document.documentElement.classList.add('dark');

    // Set up metadata since we don't have react-helmet yet
    document.title = "Project S – Self-hosted scheduling";

    // Create or update meta tags
    const metaTags = [
      { name: "description", content: "Project S is self-hostable scheduling software that separates booking preparation, human approval, and database-authoritative creation." },
      { property: "og:title", content: "Project S – Self-hosted scheduling" },
      { property: "og:description", content: "Agents prepare. People approve. PostgreSQL rechecks policy and availability before creation." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex, nofollow" }
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

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
