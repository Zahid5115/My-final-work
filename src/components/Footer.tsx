import React from 'react';
import { Link } from 'react-router-dom';
import { GOOGLE_PROFILE_INFO } from '../data/servicesData';

export const Footer: React.FC<{ businessInfo?: typeof GOOGLE_PROFILE_INFO }> = ({
  businessInfo = GOOGLE_PROFILE_INFO
}) => {
  return (
    <footer className="border-t border-emerald-950/15 bg-emerald-950 text-lime-100 dark:border-lime-300/15 dark:bg-[#021209]">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
          <div className="md:col-span-5">
            <p className="font-display text-lg font-bold text-lime-300">
              {businessInfo.businessName}
            </p>
            <p className="mt-2 text-sm text-lime-100/80">
              {businessInfo.address}
            </p>
            <p className="mt-1 font-mono-tabular text-sm font-semibold text-lime-200">
              {businessInfo.phone} · {businessInfo.email}
            </p>
          </div>

          <div className="md:col-span-3">
            <h4 className="text-xs font-semibold text-lime-300/80">Quick Links</h4>
            <ul className="mt-3 space-y-2 text-sm font-medium text-lime-100">
              <li>
                <a href="#services" className="hover:text-lime-300 hover:underline">
                  Preservation &amp; Handyman
                </a>
              </li>
              <li>
                <a href="#estimator" className="hover:text-lime-300 hover:underline">
                  Quote Estimator
                </a>
              </li>
              <li>
                <a href="#work-orders" className="hover:text-lime-300 hover:underline">
                  Work Orders &amp; Coverage
                </a>
              </li>
              <li>
                <a href="#vendor-portal" className="hover:text-lime-300 hover:underline">
                  Vendor Portal &amp; Application
                </a>
              </li>
              <li>
                <a href="#about" className="hover:text-lime-300 hover:underline">
                  About the LLC &amp; Reviews
                </a>
              </li>
              <li>
                <Link to="/admin" className="hover:text-lime-300 hover:underline">
                  Staff Admin Portal
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-4">
            <h4 className="text-xs font-semibold text-lime-300/80">
              HUD / FHA &amp; Field Compliance Disclaimer
            </h4>
            <p className="mt-3 text-xs leading-relaxed text-lime-100/75">
              All property preservation, winterization, securing, and debris abatement work orders
              are executed in accordance with current HUD/FHA Mortgagee Letters, investor allowables,
              and local municipal property codes.
            </p>
            <p className="mt-3 text-xs text-lime-200/75">
              Shortcut: Press{' '}
              <kbd className="rounded border border-lime-300/35 px-1.5 py-0.5 font-mono-tabular">
                D
              </kbd>{' '}
              anywhere outside an input to toggle light/dark mode.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-lime-200/15 pt-6 text-xs text-lime-200/70 sm:flex-row sm:items-center">
          <p>
            &copy; {new Date().getFullYear()} {businessInfo.businessName}. All rights
            reserved.
          </p>
          <p>Licensed, Bonded &amp; Insured · U.S. Field Preservation Network</p>
        </div>
      </div>
    </footer>
  );
};
