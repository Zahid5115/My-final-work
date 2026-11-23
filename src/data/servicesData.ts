export interface ServiceCategory {
  number: string;
  title: string;
  subtitle: string;
  turnaround: string;
  spanClass: string;
  items: string[];
  complianceNote: string;
}

export interface BeforeAfterCase {
  id: string;
  title: string;
  location: string;
  workOrderId: string;
  scopeSummary: string;
  turnaroundHours: number;
  beforeImage: string;
  afterImage: string;
  beforeAlt: string;
  afterAlt: string;
}

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface WorkOrderRecord {
  id: string;
  clientType: 'Mortgage Servicer' | 'REO Asset Manager' | 'Property Manager' | 'Homeowner';
  serviceType: string;
  cityState: string;
  county: string;
  status: 'Open Bid' | 'Dispatched' | 'In Progress' | 'QC Verified';
  slaDue: string;
  estimatedBudget: number;
  coordinates: LatLngPoint;
}

export interface CoverageRegion {
  region: string;
  hubCity: string;
  states: string[];
  activeCounties: number;
  avgDispatchHours: number;
  hudStandard: string;
  coordinates: LatLngPoint;
  isHeadquarters?: boolean;
}

export interface GoogleReview {
  id: string;
  reviewer: string;
  role: string;
  organization: string;
  rating: number;
  dateLabel: string;
  comment: string;
  serviceTag: string;
}

export const HERO_IMAGE = '/src/assets/images/hero_lawn_preservation_1794909182432.jpg';

export const CORE_SERVICES: ServiceCategory[] = [
  {
    number: '01.',
    title: 'Property Preservation & Securing',
    subtitle: 'Full-lifecycle field preservation aligned with HUD, FHA, VA, and Fannie Mae mortgagee guidelines.',
    turnaround: '24–48 hr standard SLA',
    spanClass: 'lg:col-span-2',
    items: [
      'Initial & recurring lock changes, re-keying, and lockbox installation',
      'Interior & exterior debris removal, trash-outs, and broom-swept cleanouts',
      'HUD-compliant window & door board-ups and structural securing',
      'Dry & wet winterization with pressure testing and antifreeze tagging',
      'Sump pump checks, roof tarping, and vacant property maintenance'
    ],
    complianceNote: 'Photo-verified completion via GPS & date-stamped mobile reporting'
  },
  {
    number: '02.',
    title: 'Lawn Care & Grounds Maintenance',
    subtitle: 'Recurring bi-weekly cuts, initial overgrown clearing, and seasonal curb-appeal restoration.',
    turnaround: '48 hr initial cut',
    spanClass: 'lg:col-span-1',
    items: [
      'Initial overgrown grass cutting (>12" clearing) and brush hogging',
      'Recurring bi-weekly mowing, string trimming, and hard-edge borders',
      'Shrub pruning, tree limb clearing, and gutter debris removal',
      'Snow removal, salting, and municipal code-violation abatement'
    ],
    complianceNote: 'Municipal grass-height & HOA compliance guaranteed'
  },
  {
    number: '03.',
    title: 'Handyman & REO Turnkey Repairs',
    subtitle: 'Licensed trade repair crews handling make-ready turns, punch lists, and landlord maintenance.',
    turnaround: '72 hr bid-to-repair',
    spanClass: 'lg:col-span-1',
    items: [
      'Drywall patching, texture matching, and interior/exterior painting',
      'Plumbing leak repairs, faucet/wax-ring replacements, and shut-offs',
      'Electrical troubleshooting, GFCI upgrades, and fixture installations',
      'Finish carpentry, subfloor repair, cabinet hardware, and door framing'
    ],
    complianceNote: 'Uniform pricing aligned with RepairBase & Xactimate scopes'
  },
  {
    number: '04.',
    title: 'Inspections & Emergency Storm Assessment',
    subtitle: 'Rapid post-storm damage documentation, occupancy checks, and emergency hazard mitigation.',
    turnaround: '4–12 hr emergency dispatch',
    spanClass: 'lg:col-span-2',
    items: [
      'Same-day occupancy verification & interior/exterior condition reports (PCR)',
      'Emergency storm tree removal, roof tarping, and water extraction dispatch',
      'FEMA/insurance-ready itemized bid scopes with high-res photo logs',
      'Mold remediation prep, basement pump-outs, and winter freeze-break mitigation'
    ],
    complianceNote: '24/7 emergency dispatch desk covering 38 U.S. states'
  }
];

export const BEFORE_AFTER_CASES: BeforeAfterCase[] = [
  {
    id: 'yard-restoration',
    title: 'Vacant Asset Curb-Appeal & Debris Abatement',
    location: 'Marion County, IN',
    workOrderId: 'WO-88412-IN',
    scopeSummary: 'Cleared 14 cubic yards of storm brush, cut 22" overgrown turf, edged driveway, and secured front porch.',
    turnaroundHours: 36,
    beforeImage: '/src/assets/images/before_overgrown_yard_1794909182781.jpg',
    afterImage: '/src/assets/images/after_manicured_yard_1794909182832.jpg',
    beforeAlt: 'Overgrown vacant residential yard with tall grass and fallen branches prior to property preservation',
    afterAlt: 'Restored residential front lawn with freshly striped green turf, edged concrete driveway, and cleared walkway'
  },
  {
    id: 'reo-interior',
    title: 'REO Living Room Drywall, Trim & Floor Turn',
    location: 'Franklin County, OH',
    workOrderId: 'WO-88509-OH',
    scopeSummary: 'Patched damaged plaster walls, primed and painted two coats, installed crisp baseboards, and refinished oak flooring.',
    turnaroundHours: 64,
    beforeImage: '/src/assets/images/before_reo_interior_1794909186324.jpg',
    afterImage: '/src/assets/images/after_reo_interior_1794909185210.jpg',
    beforeAlt: 'Distressed vacant residential living room with scuffed drywall patches and worn hardwood floors',
    afterAlt: 'Renovated clean living room interior with freshly painted smooth walls, trim, and polished hardwood floors'
  }
];

export const SAMPLE_WORK_ORDERS: WorkOrderRecord[] = [
  {
    id: 'SLC-26-4091',
    clientType: 'Mortgage Servicer',
    serviceType: 'Initial Secure + Lock Change + Winterization',
    cityState: 'Indianapolis, IN',
    county: 'Marion',
    status: 'QC Verified',
    slaDue: 'Completed in 28 hrs',
    estimatedBudget: 485,
    coordinates: { lat: 39.7684, lng: -86.1581 }
  },
  {
    id: 'SLC-26-4104',
    clientType: 'REO Asset Manager',
    serviceType: '18 Cu. Yd. Debris Trash-Out & Overgrown Cut',
    cityState: 'Columbus, OH',
    county: 'Franklin',
    status: 'In Progress',
    slaDue: 'Due in 14 hrs',
    estimatedBudget: 1120,
    coordinates: { lat: 39.9612, lng: -82.9988 }
  },
  {
    id: 'SLC-26-4118',
    clientType: 'Property Manager',
    serviceType: 'Drywall Patch, Interior Paint & GFCI Swap',
    cityState: 'Louisville, KY',
    county: 'Jefferson',
    status: 'Dispatched',
    slaDue: 'Due in 32 hrs',
    estimatedBudget: 740,
    coordinates: { lat: 38.2527, lng: -85.7585 }
  },
  {
    id: 'SLC-26-4129',
    clientType: 'REO Asset Manager',
    serviceType: 'Emergency Roof Tarp & Fallen Limb Removal',
    cityState: 'Charlotte, NC',
    county: 'Mecklenburg',
    status: 'Open Bid',
    slaDue: 'Bid window: 6 hrs',
    estimatedBudget: 950,
    coordinates: { lat: 35.2271, lng: -80.8431 }
  },
  {
    id: 'SLC-26-4135',
    clientType: 'Homeowner',
    serviceType: 'Bi-Weekly Lawn Care & Shrub Trimming',
    cityState: 'Nashville, TN',
    county: 'Davidson',
    status: 'Open Bid',
    slaDue: 'Bid window: 24 hrs',
    estimatedBudget: 185,
    coordinates: { lat: 36.1627, lng: -86.7816 }
  }
];

export const COVERAGE_REGIONS: CoverageRegion[] = [
  {
    region: 'Midwest Operations Hub',
    hubCity: 'Indianapolis, IN',
    states: ['IN', 'OH', 'IL', 'MI', 'KY', 'MO', 'WI', 'MN'],
    activeCounties: 312,
    avgDispatchHours: 18,
    hudStandard: 'HUD ML 2022-07 & Winterization Protocols',
    coordinates: { lat: 39.7684, lng: -86.1581 },
    isHeadquarters: true
  },
  {
    region: 'Southeast & Gulf Corridor',
    hubCity: 'Charlotte, NC',
    states: ['NC', 'SC', 'GA', 'TN', 'FL', 'AL', 'VA', 'TX'],
    activeCounties: 428,
    avgDispatchHours: 22,
    hudStandard: 'FEMA/HUD Storm Mitigation & Lawn Abatement',
    coordinates: { lat: 35.2271, lng: -80.8431 }
  },
  {
    region: 'Northeast & Mid-Atlantic',
    hubCity: 'Pittsburgh, PA',
    states: ['PA', 'NJ', 'NY', 'MD', 'DE', 'CT', 'MA'],
    activeCounties: 194,
    avgDispatchHours: 24,
    hudStandard: 'Municipal Code & Freeze-Protection Standards',
    coordinates: { lat: 40.4406, lng: -79.9959 }
  },
  {
    region: 'West & Mountain States',
    hubCity: 'Phoenix, AZ',
    states: ['AZ', 'CO', 'NV', 'UT', 'TX', 'WA', 'OR'],
    activeCounties: 165,
    avgDispatchHours: 26,
    hudStandard: 'Xeriscape Maintenance & REO Securing',
    coordinates: { lat: 33.4484, lng: -112.074 }
  }
];

export const GOOGLE_PROFILE_INFO = {
  businessName: "Smoker's Lawn Care Service LLC",
  address: '13306 Caine Ave, Cleveland, OH 44105',
  phone: '(800) 555-0194',
  email: 'Smokeslawncare@gmail.com',
  hours: 'Mon–Sat 7:00 AM – 7:00 PM EST · 24/7 Emergency Dispatch',
  rating: 4.9,
  reviewCount: 284,
  googleMapsProfileUrl: 'https://www.google.com/maps/search/?api=1&query=Smokers+Lawn+Care+Service+LLC+Indianapolis+IN'
};

export const GOOGLE_REVIEWS: GoogleReview[] = [
  {
    id: 'rev-1',
    reviewer: 'Rachel Vance',
    role: 'Regional Asset Manager',
    organization: 'Heartland REO Servicing',
    rating: 5,
    dateLabel: '2 weeks ago',
    serviceTag: 'Property Preservation & Winterization',
    comment:
      'We migrated 140 vacant Indiana and Ohio properties to Smoker’s Lawn Care Service LLC after repeated missed cut windows elsewhere. Before-and-after GPS photo sets arrive within 36 hours and pass HUD audit review on the first pass.'
  },
  {
    id: 'rev-2',
    reviewer: 'Marcus Delgado',
    role: 'Director of Field Operations',
    organization: 'Keystone SFR Portfolio',
    rating: 5,
    dateLabel: '1 month ago',
    serviceTag: 'REO Handyman & Make-Ready Turns',
    comment:
      'Their handyman crews turned 9 rental units in Louisville ahead of lease-up. Drywall patches, lock re-keys, and overgrown yard cleanups were completed under one work order without separate vendor markups.'
  },
  {
    id: 'rev-3',
    reviewer: 'Denise Whitaker',
    role: 'Homeowner',
    organization: 'Marion County Residence',
    rating: 5,
    dateLabel: '1 month ago',
    serviceTag: 'Emergency Storm Cleanup & Lawn Care',
    comment:
      'After severe wind downed two limbs onto our porch, their dispatch team arrived the same afternoon, cleared the debris cleanly, and kept our lawn edged all summer. Transparent pricing and zero surprises.'
  }
];
