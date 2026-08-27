
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Github, Menu, PlayCircle, X } from 'lucide-react';
import Logo from '@/components/common/Logo';

const Navbar = () => {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  return (
    <header className="py-4 px-6 md:px-8 w-full sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="container mx-auto">
        <div className="flex items-center justify-between">
          <Logo showBanner={true} size="lg" />

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-8">
            <Link
              to="/features"
              className={`${isActive('/features') ? 'text-foreground' : 'text-foreground/80'} hover:text-foreground transition-colors`}
            >
              Features
            </Link>
            <Link
              to="/demo"
              className={`${isActive('/demo') ? 'text-foreground' : 'text-foreground/80'} hover:text-foreground transition-colors`}
            >
              Demo
            </Link>
            <Link
              to="/about"
              className={`${isActive('/about') ? 'text-foreground' : 'text-foreground/80'} hover:text-foreground transition-colors`}
            >
              About
            </Link>
          </nav>

          {/* Desktop evaluation links */}
          <div className="hidden md:flex items-center space-x-4">
            <Button asChild variant="ghost" size="sm">
              <a href="https://github.com/EP2-Git/project-s">
                <Github className="mr-2 h-4 w-4" aria-hidden="true" />
                Source
              </a>
            </Button>
            <Button asChild size="sm" className="bg-lavender hover:bg-lavender-light">
              <Link to="/demo">
                <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                Review the proof
              </Link>
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex md:hidden">
            <button
              onClick={toggleMobileMenu}
              className="p-2 text-foreground"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-background border-b border-border py-4 px-6 animate-fade-in z-40">
          <nav className="flex flex-col space-y-4">
            <Link
              to="/features"
              className={`${isActive('/features') ? 'text-foreground' : 'text-foreground/80'} py-2 hover:text-foreground transition-colors`}
              onClick={() => setMobileMenuOpen(false)}
            >
              Features
            </Link>
            <Link
              to="/demo"
              className={`${isActive('/demo') ? 'text-foreground' : 'text-foreground/80'} py-2 hover:text-foreground transition-colors`}
              onClick={() => setMobileMenuOpen(false)}
            >
              Demo
            </Link>
            <Link
              to="/about"
              className={`${isActive('/about') ? 'text-foreground' : 'text-foreground/80'} py-2 hover:text-foreground transition-colors`}
              onClick={() => setMobileMenuOpen(false)}
            >
              About
            </Link>
            <div className="pt-4 flex flex-col space-y-3">
              <Button asChild variant="ghost" className="w-full justify-start">
                <a href="https://github.com/EP2-Git/project-s" onClick={() => setMobileMenuOpen(false)}>
                  <Github className="mr-2 h-4 w-4" aria-hidden="true" />
                  Source
                </a>
              </Button>
              <Button asChild className="w-full justify-start bg-lavender hover:bg-lavender-light">
                <Link to="/demo" onClick={() => setMobileMenuOpen(false)}>
                  <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                  Review the proof
                </Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
};

export default Navbar;
