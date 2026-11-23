import { useCallback, useEffect, useState } from 'react';
import {
  BEFORE_AFTER_CASES,
  CORE_SERVICES,
  COVERAGE_REGIONS,
  GOOGLE_PROFILE_INFO,
  GOOGLE_REVIEWS,
  SAMPLE_WORK_ORDERS,
  type BeforeAfterCase,
  type CoverageRegion,
  type GoogleReview,
  type ServiceCategory,
  type WorkOrderRecord
} from '../data/servicesData';
import { fetchPublicBootstrap } from '../services/api';
import type { BusinessSettingsEntity, PublicBootstrapData } from '../types/platform';

export interface PublicSiteData {
  services: ServiceCategory[];
  galleryCases: BeforeAfterCase[];
  coverageRegions: CoverageRegion[];
  reviews: GoogleReview[];
  workOrders: WorkOrderRecord[];
  businessInfo: typeof GOOGLE_PROFILE_INFO;
  reload: () => Promise<void>;
}

const DEFAULT_FALLBACK: Omit<PublicSiteData, 'reload'> = {
  services: CORE_SERVICES,
  galleryCases: BEFORE_AFTER_CASES,
  coverageRegions: COVERAGE_REGIONS,
  reviews: GOOGLE_REVIEWS,
  workOrders: SAMPLE_WORK_ORDERS,
  businessInfo: GOOGLE_PROFILE_INFO
};

function mapBootstrapToSiteData(data: PublicBootstrapData): Omit<PublicSiteData, 'reload'> {
  const services: ServiceCategory[] = data.services.map((s) => ({
    number: s.serviceNumber,
    title: s.title,
    subtitle: s.subtitle,
    turnaround: s.turnaround,
    spanClass: 'lg:col-span-1',
    items: s.items,
    complianceNote: s.complianceNote
  }));

  const galleryCases: BeforeAfterCase[] = data.galleryCases.map((g) => ({
    id: g.id,
    title: g.title,
    location: g.location,
    workOrderId: g.workOrderId,
    scopeSummary: g.scopeSummary,
    turnaroundHours: g.turnaroundHours,
    beforeImage: g.beforeImage,
    afterImage: g.afterImage,
    beforeAlt: g.beforeAlt,
    afterAlt: g.afterAlt
  }));

  const coverageRegions: CoverageRegion[] = data.coverageRegions.map((r) => ({
    region: r.region,
    hubCity: r.hubCity,
    states: r.states,
    activeCounties: r.activeCounties,
    avgDispatchHours: r.avgDispatchHours,
    hudStandard: r.hudStandard,
    coordinates:
      r.lat !== null && r.lng !== null
        ? { lat: r.lat, lng: r.lng }
        : { lat: 39.7684, lng: -86.1581 },
    isHeadquarters: r.isHeadquarters
  }));

  const reviews: GoogleReview[] = data.reviews.map((rev) => ({
    id: rev.id,
    reviewer: rev.reviewer,
    role: rev.role,
    organization: rev.organization,
    rating: rev.rating,
    dateLabel: rev.dateLabel,
    comment: rev.comment,
    serviceTag: rev.serviceTag
  }));

  const workOrders: WorkOrderRecord[] = data.publicWorkOrders.map((wo) => ({
    id: wo.workOrderCode,
    clientType:
      wo.clientType === 'Mortgage Servicer' ||
      wo.clientType === 'REO Asset Manager' ||
      wo.clientType === 'Property Manager' ||
      wo.clientType === 'Homeowner'
        ? wo.clientType
        : 'Property Manager',
    serviceType: wo.serviceType,
    cityState: wo.cityState,
    county: wo.county || 'Regional',
    status:
      wo.status === 'Open Bid' ||
      wo.status === 'Dispatched' ||
      wo.status === 'In Progress' ||
      wo.status === 'QC Verified'
        ? wo.status
        : 'Open Bid',
    slaDue: wo.slaDue,
    estimatedBudget: wo.estimatedBudget,
    coordinates: wo.coordinates ?? { lat: 39.7684, lng: -86.1581 }
  }));

  const bs: BusinessSettingsEntity = data.businessSettings;
  const businessInfo = {
    businessName: bs.businessName || GOOGLE_PROFILE_INFO.businessName,
    address: bs.address || GOOGLE_PROFILE_INFO.address,
    phone: bs.phone || GOOGLE_PROFILE_INFO.phone,
    email: bs.email || GOOGLE_PROFILE_INFO.email,
    hours: bs.hours || GOOGLE_PROFILE_INFO.hours,
    rating: bs.googleRating || GOOGLE_PROFILE_INFO.rating,
    reviewCount: bs.googleReviewCount || GOOGLE_PROFILE_INFO.reviewCount,
    googleMapsProfileUrl: bs.googleProfileUrl || GOOGLE_PROFILE_INFO.googleMapsProfileUrl
  };

  return {
    services: services.length > 0 ? services : CORE_SERVICES,
    galleryCases: galleryCases.length > 0 ? galleryCases : BEFORE_AFTER_CASES,
    coverageRegions: coverageRegions.length > 0 ? coverageRegions : COVERAGE_REGIONS,
    reviews: reviews.length > 0 ? reviews : GOOGLE_REVIEWS,
    workOrders: workOrders.length > 0 ? workOrders : SAMPLE_WORK_ORDERS,
    businessInfo
  };
}

export function usePublicBootstrap(): PublicSiteData {
  const [siteData, setSiteData] = useState<Omit<PublicSiteData, 'reload'>>(DEFAULT_FALLBACK);

  const reload = useCallback(async () => {
    try {
      const bootstrap = await fetchPublicBootstrap();
      setSiteData(mapBootstrapToSiteData(bootstrap));
    } catch {
      // Keep fallback data if backend is unreachable during static render
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    ...siteData,
    reload
  };
}
