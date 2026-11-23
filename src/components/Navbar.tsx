import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Menu, Moon, Sun, X } from 'lucide-react';

interface NavbarProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onAboutClick: () => void;
  onRequestBidClick: () => void;
}

const NAV_LINKS = [
  { label: 'Services', href: '#services' },
  { label: 'Gallery', href: '#gallery' },
  { label: 'Estimator', href: '#estimator' },
  { label: 'Work Orders', href: '#work-orders' },
  { label: 'Vendor Portal', href: '#vendor-portal' },
  { label: 'About', href: '#about', isAbout: true }
];

export const Navbar: React.FC<NavbarProps> = ({
  isDark,
  onToggleTheme,
  onAboutClick,
  onRequestBidClick
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isEditable) return;

      const isSingleD =
        event.key.toLowerCase() === 'd' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;
      const isAltT = event.altKey && event.key.toLowerCase() === 't';

      if (isSingleD || isAltT) {
        event.preventDefault();
        onToggleTheme();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleTheme]);

  const handleNavClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
    isAbout?: boolean
  ) => {
    setMobileOpen(false);
    if (isAbout) {
      e.preventDefault();
      onAboutClick();
      const targetEl = document.querySelector(href);
      targetEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-emerald-950/12 bg-white/90 backdrop-blur-md dark:border-lime-300/15 dark:bg-[#03170C]/92">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 sm:gap-6 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#top"
          className="font-display text-sm sm:text-base lg:text-lg font-bold tracking-tight text-[#052E16] dark:text-lime-100 whitespace-nowrap truncate min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#052E16] dark:focus-visible:outline-lime-300 rounded"
        >
          Smoker&apos;s Lawn Care Service
        </a>

        {/* Zone 2: Desktop Horizontal Navigation */}
        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center gap-5 xl:gap-7 text-[13px] xl:text-sm font-medium text-[#052E16]/80 dark:text-lime-100/80 shrink-0"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href, link.isAbout)}
              className="whitespace-nowrap shrink-0 py-1 underline-offset-4 hover:text-[#052E16] hover:underline dark:hover:text-lime-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#052E16] dark:focus-visible:outline-lime-300 rounded"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Zone 3: Theme Toggle, Menu Button (<lg), Primary CTA */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch to light mode (Shortcut: D)' : 'Switch to dark mode (Shortcut: D)'}
            aria-pressed={isDark}
            title={isDark ? 'Light mode (Press D)' : 'Dark mode (Press D)'}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-950/15 bg-lime-100 text-[#052E16] hover:bg-lime-200 dark:border-lime-400/40 dark:bg-lime-400 dark:text-[#052E16] dark:hover:bg-lime-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#052E16] dark:focus-visible:outline-lime-300 cursor-pointer shrink-0"
          >
            <AnimatePresence mode="wait" initial={false}>
              {isDark ? (
                <motion.span
                  key="sun"
                  initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, rotate: -45, scale: 0.75 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, rotate: 45, scale: 0.75 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center justify-center"
                >
                  <Sun className="h-4 w-4" aria-hidden="true" />
                </motion.span>
              ) : (
                <motion.span
                  key="moon"
                  initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, rotate: 45, scale: 0.75 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, rotate: -45, scale: 0.75 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center justify-center"
                >
                  <Moon className="h-4 w-4" aria-hidden="true" />
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="inline-flex lg:hidden items-center gap-1.5 rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs font-semibold text-[#052E16] hover:bg-lime-100 dark:border-lime-400/35 dark:bg-[#072716] dark:text-lime-100 cursor-pointer whitespace-nowrap shrink-0"
          >
            {mobileOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
            <span>{mobileOpen ? 'Close' : 'Menu'}</span>
          </button>

          <button
            type="button"
            onClick={onRequestBidClick}
            className="hidden sm:inline-flex items-center justify-center rounded-lg bg-[#052E16] px-3.5 py-2 text-xs sm:text-sm font-semibold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] dark:hover:bg-lime-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Request a Bid
          </button>
        </div>
      </div>

      {/* Responsive Dropdown Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            id="mobile-nav-drawer"
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            className="lg:hidden border-t border-emerald-950/15 bg-white px-4 py-4 shadow-lg dark:border-lime-300/15 dark:bg-[#052E16]"
          >
            <nav className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label="Mobile Navigation">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={(e) => handleNavClick(e, link.href, link.isAbout)}
                  className="rounded-lg px-3 py-2.5 text-sm font-semibold text-[#052E16] hover:bg-lime-200 dark:text-lime-100 dark:hover:bg-[#0C3D22]"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                onRequestBidClick();
              }}
              className="mt-3 w-full rounded-lg bg-[#052E16] px-4 py-3 text-sm font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]"
            >
              Request a Bid / Free Quote
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};
