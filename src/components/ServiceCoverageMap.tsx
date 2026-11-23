import React, { useEffect, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap
} from '@vis.gl/react-google-maps';
import { Compass, Layers, MapPin } from 'lucide-react';
import type { CoverageRegion, WorkOrderRecord } from '../data/servicesData';
import { apiRequest } from '../services/api';

function cleanMapsKey(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  return trimmed && trimmed !== 'MY_GOOGLE_MAPS_API_KEY' ? trimmed : '';
}

function isValidCoordinates(coords: { lat: number; lng: number } | null | undefined): boolean {
  return Boolean(coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng));
}

const BUILD_MAPS_API_KEY = cleanMapsKey(
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
);

const US_NATIONAL_CENTER = { lat: 38.2, lng: -92.5 };

interface ServiceCoverageMapProps {
  regions: CoverageRegion[];
  workOrders: WorkOrderRecord[];
  activeRegionIdx: number;
  selectedWorkOrder: WorkOrderRecord | null;
  onSelectRegion: (idx: number) => void;
  onSelectWorkOrder: (wo: WorkOrderRecord | null) => void;
  isDark: boolean;
}

interface HubMarkerProps {
  region: CoverageRegion;
  isActive: boolean;
  onSelect: () => void;
}

const HubMarker: React.FC<HubMarkerProps> = ({ region, isActive, onSelect }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={region.coordinates}
        title={`${region.region} (${region.hubCity})`}
        onClick={onSelect}
      >
        <Pin
          background={isActive ? '#BEF264' : '#052E16'}
          borderColor={isActive ? '#052E16' : '#BEF264'}
          glyphColor={isActive ? '#052E16' : '#BEF264'}
          scale={isActive ? 1.2 : 1.0}
        />
      </AdvancedMarker>

      {isActive && marker && (
        <InfoWindow anchor={marker} maxWidth={240}>
          <div className="p-1 text-[#052E16]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
              {region.isHeadquarters ? 'National HQ' : 'Regional Hub'}
            </p>
            <p className="mt-0.5 text-sm font-bold">{region.hubCity}</p>
            <p className="mt-1 text-xs text-emerald-950/80">
              {region.activeCounties} active counties · {region.avgDispatchHours}h avg SLA
            </p>
            <p className="mt-1 text-[11px] text-emerald-900/75">
              States: {region.states.join(', ')}
            </p>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface WorkOrderMarkerProps {
  workOrder: WorkOrderRecord;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
}

const WorkOrderMarker: React.FC<WorkOrderMarkerProps> = ({
  workOrder,
  isSelected,
  onSelect,
  onClose
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={workOrder.coordinates}
        title={`${workOrder.id} · ${workOrder.cityState}`}
        onClick={onSelect}
      >
        <Pin
          background={isSelected ? '#EA580C' : '#0F172A'}
          borderColor="#FFFFFF"
          glyphColor="#FFFFFF"
          scale={isSelected ? 1.15 : 0.85}
        />
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} maxWidth={240} onCloseClick={onClose}>
          <div className="p-1 text-[#052E16]">
            <p className="font-mono text-[11px] font-bold text-orange-700">
              {workOrder.id} · {workOrder.status}
            </p>
            <p className="mt-0.5 text-xs font-bold">{workOrder.serviceType}</p>
            <p className="mt-1 text-[11px] text-emerald-950/80">
              {workOrder.cityState} ({workOrder.county} Co.) · ${workOrder.estimatedBudget}
            </p>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface MapCameraSyncProps {
  focusPoint: { lat: number; lng: number; zoom: number } | null;
}

const MapCameraSync: React.FC<MapCameraSyncProps> = ({ focusPoint }) => {
  const map = useMap();

  useEffect(() => {
    if (!map || !focusPoint) return;
    map.panTo({ lat: focusPoint.lat, lng: focusPoint.lng });
    map.setZoom(focusPoint.zoom);
  }, [map, focusPoint]);

  return null;
};

const MapCanvasInner: React.FC<ServiceCoverageMapProps> = ({
  regions,
  workOrders,
  activeRegionIdx,
  selectedWorkOrder,
  onSelectRegion,
  onSelectWorkOrder,
  isDark
}) => {
  const status = useApiLoadingStatus();
  const [mapType, setMapType] = useState<'roadmap' | 'hybrid'>('roadmap');
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lng: number; zoom: number } | null>(
    null
  );

  useEffect(() => {
    if (status === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  }, [status]);

  useEffect(() => {
    if (selectedWorkOrder && isValidCoordinates(selectedWorkOrder.coordinates)) {
      setFocusPoint({
        lat: selectedWorkOrder.coordinates.lat,
        lng: selectedWorkOrder.coordinates.lng,
        zoom: 7
      });
      return;
    }
    const region = regions[activeRegionIdx];
    if (region && isValidCoordinates(region.coordinates)) {
      setFocusPoint({
        lat: region.coordinates.lat,
        lng: region.coordinates.lng,
        zoom: 5
      });
    }
  }, [activeRegionIdx, regions, selectedWorkOrder]);

  if (status === APILoadingStatus.AUTH_FAILURE || status === APILoadingStatus.FAILED) {
    return (
      <div className="flex h-[360px] w-full flex-col items-center justify-center rounded-xl border border-emerald-950/15 bg-white p-6 text-center text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100">
        <MapPin className="h-8 w-8 text-emerald-700 dark:text-lime-400" aria-hidden="true" />
        <p className="mt-3 font-display text-base font-bold">
          Interactive Map Unavailable
        </p>
        <p className="mt-1 max-w-sm text-xs opacity-75">
          Unable to load Google Maps tiles right now. Regional coverage and active work order lists
          remain fully accessible below.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Map Controls Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs font-medium text-[#052E16]/80 dark:text-lime-200/80">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#052E16] ring-1 ring-[#BEF264]" />
            Regional Hubs
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0F172A] ring-1 ring-white" />
            Work Orders
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onSelectWorkOrder(null);
              setFocusPoint({ ...US_NATIONAL_CENTER, zoom: 4 });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-950/15 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100 cursor-pointer"
          >
            <Compass className="h-3.5 w-3.5" aria-hidden="true" />
            U.S. View
          </button>

          <button
            type="button"
            onClick={() => setMapType((prev) => (prev === 'roadmap' ? 'hybrid' : 'roadmap'))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-950/15 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100 cursor-pointer"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            {mapType === 'roadmap' ? 'Satellite' : 'Roadmap'}
          </button>
        </div>
      </div>

      {/* Explicit Sized Map Container (CF2) */}
      <div className="h-[340px] sm:h-[390px] w-full overflow-hidden rounded-xl border border-emerald-950/15 bg-emerald-950/5 dark:border-lime-300/20">
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={US_NATIONAL_CENTER}
          defaultZoom={4}
          mapTypeId={mapType}
          colorScheme={isDark ? 'DARK' : 'LIGHT'}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          <MapCameraSync focusPoint={focusPoint} />

          {regions
            .filter((region) => isValidCoordinates(region.coordinates))
            .map((region, idx) => (
              <HubMarker
                key={region.region}
                region={region}
                isActive={!selectedWorkOrder && activeRegionIdx === idx}
                onSelect={() => {
                  onSelectWorkOrder(null);
                  onSelectRegion(idx);
                }}
              />
            ))}

          {workOrders
            .filter((wo) => isValidCoordinates(wo.coordinates))
            .map((wo) => (
              <WorkOrderMarker
                key={wo.id}
                workOrder={wo}
                isSelected={selectedWorkOrder?.id === wo.id}
                onSelect={() => onSelectWorkOrder(wo)}
                onClose={() => onSelectWorkOrder(null)}
              />
            ))}
        </GoogleMap>
      </div>
    </div>
  );
};

export const ServiceCoverageMap: React.FC<ServiceCoverageMapProps> = (props) => {
  const [mapsApiKey, setMapsApiKey] = useState<string>(BUILD_MAPS_API_KEY);
  const [checkingRuntimeKey, setCheckingRuntimeKey] = useState<boolean>(!BUILD_MAPS_API_KEY);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (BUILD_MAPS_API_KEY) return;
    let cancelled = false;
    void apiRequest<{ apiKey?: string }>('/api/public/maps-config', {
      skipUnauthorizedCallback: true
    })
      .then((res) => {
        if (!cancelled) {
          const runtimeKey = cleanMapsKey(res?.apiKey);
          if (runtimeKey) {
            setMapsApiKey(runtimeKey);
            setConfigError(null);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setConfigError(err instanceof Error ? err.message : null);
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingRuntimeKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checkingRuntimeKey) {
    return (
      <div className="flex h-[340px] w-full flex-col items-center justify-center rounded-xl border border-emerald-950/15 bg-white p-6 text-center text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100">
        <MapPin className="h-7 w-7 animate-pulse text-emerald-700 dark:text-lime-400" aria-hidden="true" />
        <p className="mt-2 text-xs font-semibold opacity-75">Loading interactive Google Map...</p>
      </div>
    );
  }

  if (!mapsApiKey) {
    return (
      <div className="flex h-[340px] w-full flex-col items-center justify-center rounded-xl border border-emerald-950/15 bg-white p-6 text-center text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100">
        <MapPin className="h-8 w-8 text-emerald-700 dark:text-lime-400" aria-hidden="true" />
        <p className="mt-3 font-display text-base font-bold">
          Google Maps API Key Required
        </p>
        <p className="mt-1 max-w-md text-xs opacity-75">
          {configError
            ? configError
            : (
              <>
                Configure <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> (or{' '}
                <code className="font-mono">GOOGLE_MAPS_API_KEY</code>) in your deployment environment variables and redeploy to display the live regional hub and work-order coverage map.
              </>
            )}
        </p>
      </div>
    );
  }

  return (
    <APIProvider
      apiKey={mapsApiKey}
      libraries={['marker']}
      language="en"
      region="US"
    >
      <MapCanvasInner {...props} />
    </APIProvider>
  );
};
