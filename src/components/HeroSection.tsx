
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Calendar, ArrowRight, PlayCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import Container from '@/components/ui/container';

const HeroSection = () => {
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<number | null>(2);

  const handleTimeSlotClick = (index: number) => {
    setSelectedTimeSlot(index);
  };

  return (
    <section className="pt-8 md:pt-16 pb-16 md:pb-20 px-4 md:px-6">
      <Container>
        <div className="flex flex-col lg:flex-row items-center justify-between gap-8 md:gap-12">
          <div className="flex-1 space-y-6 md:space-y-8 text-center lg:text-left">
            <div className="space-y-4 md:space-y-6">
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-5xl xl:text-6xl font-bold leading-tight">
                <span className="inline-block">Project S –</span>{" "}
                <span className="inline-block">Agents prepare. People approve.</span>{" "}
                <span className="text-lavender inline-block">The database commits.</span>
              </h1>
              <p className="text-base md:text-lg lg:text-xl text-foreground/80 max-w-2xl mx-auto lg:mx-0">
                Self-host a four-operation scheduling boundary where preparation is not permission and final creation is revalidated under a database lock.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
              <Link to="/demo" className="w-full sm:w-auto">
                <Button size="lg" className="bg-lavender hover:bg-lavender-light w-full">
                  <PlayCircle className="mr-2 h-4 w-4" /> See authority demo
                </Button>
              </Link>
              <Link to="/about" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="w-full">
                  Read how it works <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>

            <div className="text-sm text-foreground/60 flex items-center justify-center lg:justify-start">
              <span>Apache-2.0 public pre-alpha · Bring your own Supabase project</span>
            </div>
          </div>

          <div className="flex-1 relative w-full max-w-md mx-auto lg:max-w-none">
            <div className="bg-gradient-to-br from-lavender/20 to-lavender/5 rounded-2xl p-1.5">
              <div className="glass-card rounded-xl p-4 md:p-6 animate-float">
                <div className="flex items-center mb-4 space-x-3">
                  <Calendar className="h-5 w-5 text-lavender" />
                  <h3 className="font-semibold text-sm md:text-base truncate">Choose a time for your meeting</h3>
                </div>
                <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4">
                  {[...Array(6)].map((_, i) => (
                    <motion.button
                      type="button"
                      key={i}
                      aria-pressed={i === selectedTimeSlot}
                      aria-label={`Select ${10 + i}:00${i < 2 ? 'am' : 'pm'}`}
                      className={`relative p-2 md:p-3 rounded-lg border text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        i === selectedTimeSlot ? 'border-lavender bg-lavender/10 text-lavender' : 'border-border hover:border-lavender/50'
                      }`}
                      onClick={() => handleTimeSlotClick(i)}
                      whileTap={{ scale: 0.98 }}
                      layout
                      transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 25,
                        mass: 1,
                        duration: 0.3
                      }}
                    >
                      <div className="text-xs md:text-sm font-medium whitespace-nowrap">
                        {10 + i}:00{i < 2 ? 'am' : 'pm'}
                      </div>

                      {i === selectedTimeSlot && (
                        <motion.div
                          layoutId="highlight"
                          className="absolute inset-0 border-2 border-lavender rounded-lg pointer-events-none"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{
                            duration: 0.3,
                            ease: "easeInOut"
                          }}
                        />
                      )}
                    </motion.button>
                  ))}
                </div>
                <div className="p-2 md:p-3 bg-foreground/5 rounded-lg">
                  <div className="flex mb-1 md:mb-2">
                    <div className="h-2 w-2 rounded-full bg-lavender mt-1 mr-2 flex-shrink-0" />
                    <p className="text-xs md:text-sm font-medium">Server-validated free slots</p>
                  </div>
                  <p className="text-xs text-foreground/70 ml-4">Based on host availability and existing bookings</p>
                </div>
              </div>
            </div>

            <div className="absolute -bottom-4 -right-4 md:-bottom-6 md:-right-6 bg-lavender/80 backdrop-blur-sm px-3 py-1 md:px-4 md:py-2 rounded-lg text-white text-xs md:text-sm font-medium">
              <span>Time-zone aware</span>
            </div>
          </div>
        </div>

        <div className="bg-background/50 border border-border/40 rounded-xl p-4 md:p-6 mt-12 md:mt-20">
          <h2 className="text-xl md:text-2xl font-bold mb-4 text-center">Why Project S?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            <div className="p-3 md:p-4 bg-lavender/10 rounded-lg">
              <h3 className="font-semibold mb-2 text-base md:text-lg">Self-hostable</h3>
              <p className="text-sm md:text-base text-foreground/80">Run the application and scheduling database on infrastructure you control.</p>
            </div>
            <div className="p-3 md:p-4 bg-lavender/10 rounded-lg">
              <h3 className="font-semibold mb-2 text-base md:text-lg">Database-enforced</h3>
              <p className="text-sm md:text-base text-foreground/80">Overlap protection and current availability are rechecked under the host lock before insertion.</p>
            </div>
            <div className="p-3 md:p-4 bg-lavender/10 rounded-lg">
              <h3 className="font-semibold mb-2 text-base md:text-lg">Tested interaction states</h3>
              <p className="text-sm md:text-base text-foreground/80">Selected keyboard, reflow, mobile-review, and Axe checks run in browser CI.</p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default HeroSection;
