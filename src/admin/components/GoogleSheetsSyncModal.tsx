import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FolderPlus,
  LogOut,
  RefreshCw,
  UploadCloud,
  X
} from 'lucide-react';
import { GoogleSignInButton } from '../../components/GoogleSignInButton';
import {
  clearGoogleSheetsAccessToken,
  getGoogleSheetsAccessToken,
  googleSheetsSignIn,
  googleSheetsSignOut,
  initGoogleSheetsAuth
} from '../../lib/googleSheetsAuth';
import { apiRequest } from '../../services/api';
import {
  createWorkOrdersAndVendorSpreadsheet,
  DEFAULT_VENDOR_BIDS_TAB,
  DEFAULT_VENDORS_TAB,
  DEFAULT_WORK_ORDERS_TAB,
  extractSpreadsheetId,
  getSpreadsheetMetadata,
  GoogleSheetsApiError,
  parseVendorSheetRows,
  parseWorkOrderSheetRows,
  readSheetRows,
  syncVendorsAndBidsToSheet,
  syncWorkOrderAndVendorData,
  syncWorkOrdersToSheet,
  type SpreadsheetMetadata
} from '../../services/googleSheets';
import type { VendorBidEntity, VendorRecord, WorkOrderEntity } from '../../types/platform';
import { ConfirmDialog } from './ConfirmDialog';

interface GoogleSheetsSyncModalProps {
  open: boolean;
  initialScope?: 'work-orders' | 'vendors';
  workOrders?: WorkOrderEntity[];
  vendors?: VendorRecord[];
  bids?: VendorBidEntity[];
  canWriteWorkOrders?: boolean;
  canWriteVendors?: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onImported?: () => Promise<void> | void;
}

const SHEET_ID_PREF_KEY = 'slc_google_spreadsheet_id';

type PendingConfirmAction =
  | { kind: 'sync-work-orders' }
  | { kind: 'sync-vendors' }
  | { kind: 'sync-all' }
  | { kind: 'import-work-orders'; count: number }
  | { kind: 'import-vendors'; count: number };

export const GoogleSheetsSyncModal: React.FC<GoogleSheetsSyncModalProps> = ({
  open,
  initialScope = 'work-orders',
  workOrders: propWorkOrders,
  vendors: propVendors,
  bids: propBids,
  canWriteWorkOrders = false,
  canWriteVendors = false,
  onClose,
  onSuccess,
  onImported
}) => {
  const [needsAuth, setNeedsAuth] = useState(!getGoogleSheetsAccessToken());
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [sheetInput, setSheetInput] = useState<string>(() => {
    try {
      return window.localStorage.getItem(SHEET_ID_PREF_KEY) || '';
    } catch {
      return '';
    }
  });
  const [metadata, setMetadata] = useState<SpreadsheetMetadata | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>(
    initialScope === 'vendors' ? DEFAULT_VENDORS_TAB : DEFAULT_WORK_ORDERS_TAB
  );

  const [workOrders, setWorkOrders] = useState<WorkOrderEntity[]>(propWorkOrders || []);
  const [vendors, setVendors] = useState<VendorRecord[]>(propVendors || []);
  const [bids, setBids] = useState<VendorBidEntity[]>(propBids || []);

  const [previewRows, setPreviewRows] = useState<string[][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<PendingConfirmAction | null>(null);

  useEffect(() => {
    const unsub = initGoogleSheetsAuth(
      (user) => {
        setGoogleEmail(user.email || user.displayName || 'Connected Google Account');
        setNeedsAuth(false);
      },
      () => {
        setGoogleEmail(null);
        setNeedsAuth(true);
      }
    );
    return () => unsub();
  }, []);

  const loadMissingPlatformData = useCallback(async () => {
    try {
      const [woRes, vRes, bRes] = await Promise.all([
        propWorkOrders
          ? Promise.resolve({ items: propWorkOrders })
          : apiRequest<{ items: WorkOrderEntity[] }>('/api/admin/work-orders').catch(() => ({
              items: []
            })),
        propVendors
          ? Promise.resolve({ items: propVendors })
          : apiRequest<{ items: VendorRecord[] }>('/api/admin/vendors').catch(() => ({
              items: []
            })),
        propBids
          ? Promise.resolve({ items: propBids })
          : apiRequest<{ items: VendorBidEntity[] }>('/api/admin/vendor-bids').catch(() => ({
              items: []
            }))
      ]);
      setWorkOrders(woRes.items);
      setVendors(vRes.items);
      setBids(bRes.items);
    } catch {
      // Errors handled silently; individual datasets default safely
    }
  }, [propWorkOrders, propVendors, propBids]);

  useEffect(() => {
    if (open) {
      setError(null);
      setStatusNote(null);
      void loadMissingPlatformData();
    }
  }, [open, loadMissingPlatformData]);

  const handleError = (err: unknown) => {
    if (err instanceof GoogleSheetsApiError && err.status === 401) {
      clearGoogleSheetsAccessToken();
      setNeedsAuth(true);
      setError('Your Google session expired. Please sign in with Google again.');
      return;
    }
    setError(err instanceof Error ? err.message : 'Google Sheets operation failed.');
  };

  const persistSpreadsheetId = (id: string) => {
    setSheetInput(id);
    try {
      window.localStorage.setItem(SHEET_ID_PREF_KEY, id);
    } catch {
      // Ignore storage errors
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setError(null);
    try {
      const { user } = await googleSheetsSignIn();
      setGoogleEmail(user.email || user.displayName || 'Connected Google Account');
      setNeedsAuth(false);
      setStatusNote('Connected to Google Sheets.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in was cancelled or blocked.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await googleSheetsSignOut();
    setGoogleEmail(null);
    setNeedsAuth(true);
    setMetadata(null);
    setPreviewRows(null);
    setStatusNote(null);
  };

  const requireToken = (): string | null => {
    const token = getGoogleSheetsAccessToken();
    if (!token) {
      setNeedsAuth(true);
      setError('Please sign in with Google to authorize spreadsheet access.');
      return null;
    }
    return token;
  };

  const handleConnectExistingSheet = async () => {
    const token = requireToken();
    if (!token) return;
    const spreadsheetId = extractSpreadsheetId(sheetInput);
    if (!spreadsheetId) {
      setError('Enter a valid Google Spreadsheet ID or full Google Sheets URL.');
      return;
    }
    setBusy(true);
    setError(null);
    setStatusNote(null);
    try {
      const meta = await getSpreadsheetMetadata(token, spreadsheetId);
      setMetadata(meta);
      persistSpreadsheetId(meta.spreadsheetId);
      const preferred =
        meta.sheets.find((s) =>
          initialScope === 'vendors'
            ? s.title.toLowerCase().includes('vendor')
            : s.title.toLowerCase().includes('work order')
        )?.title || meta.sheets[0]?.title;
      if (preferred) setSelectedTab(preferred);
      setStatusNote(`Loaded "${meta.title}" (${meta.sheets.length} tab(s) discovered).`);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSpreadsheet = async () => {
    const token = requireToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    setStatusNote(null);
    try {
      const meta = await createWorkOrdersAndVendorSpreadsheet(token);
      setMetadata(meta);
      persistSpreadsheetId(meta.spreadsheetId);
      setSelectedTab(
        initialScope === 'vendors' ? DEFAULT_VENDORS_TAB : DEFAULT_WORK_ORDERS_TAB
      );
      setStatusNote(`Created "${meta.title}" with Work Orders, Vendor Portal, and Vendor Bids tabs.`);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleReadPreview = async () => {
    const token = requireToken();
    if (!token || !metadata) return;
    setBusy(true);
    setError(null);
    setStatusNote(null);
    try {
      const rows = await readSheetRows(token, metadata.spreadsheetId, selectedTab);
      setPreviewRows(rows);
      setStatusNote(
        rows.length > 0
          ? `Loaded ${Math.max(0, rows.length - 1)} data row(s) from "${selectedTab}".`
          : `Tab "${selectedTab}" is currently empty.`
      );
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const parsedImportWorkOrders = useMemo(() => {
    if (!previewRows) return [];
    const existingCodes = new Set(workOrders.map((w) => w.workOrderCode.toUpperCase()));
    return parseWorkOrderSheetRows(previewRows, existingCodes);
  }, [previewRows, workOrders]);

  const parsedImportVendors = useMemo(() => {
    if (!previewRows) return [];
    const existingKeys = new Set<string>();
    for (const v of vendors) {
      existingKeys.add(v.email.toLowerCase());
      existingKeys.add(v.vendorCode.toUpperCase());
    }
    return parseVendorSheetRows(previewRows, existingKeys);
  }, [previewRows, vendors]);

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    const token = requireToken();
    if (!token || !metadata) {
      setConfirmAction(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (confirmAction.kind === 'sync-work-orders') {
        const res = await syncWorkOrdersToSheet(
          token,
          metadata.spreadsheetId,
          DEFAULT_WORK_ORDERS_TAB,
          workOrders
        );
        setMetadata(res.metadata);
        const msg = `Synced ${res.count} Work Order(s) to "${metadata.title}" (${DEFAULT_WORK_ORDERS_TAB}).`;
        setStatusNote(msg);
        onSuccess(msg);
      } else if (confirmAction.kind === 'sync-vendors') {
        const res = await syncVendorsAndBidsToSheet(
          token,
          metadata.spreadsheetId,
          DEFAULT_VENDORS_TAB,
          DEFAULT_VENDOR_BIDS_TAB,
          vendors,
          bids
        );
        setMetadata(res.metadata);
        const msg = `Synced ${res.vendorCount} Vendor(s) and ${res.bidCount} Vendor Bid(s) to "${metadata.title}".`;
        setStatusNote(msg);
        onSuccess(msg);
      } else if (confirmAction.kind === 'sync-all') {
        const syncRes = await syncWorkOrderAndVendorData({
          accessToken: token,
          spreadsheetId: metadata.spreadsheetId,
          workOrders,
          vendors,
          bids
        });
        setMetadata(syncRes.metadata);
        const msg = `Full sync complete: ${syncRes.workOrderCount} Work Order(s), ${syncRes.vendorCount} Vendor(s), and ${syncRes.bidCount} Vendor Bid(s) updated in "${syncRes.title}".`;
        setStatusNote(msg);
        onSuccess(msg);
      } else if (confirmAction.kind === 'import-work-orders') {
        let imported = 0;
        for (const row of parsedImportWorkOrders) {
          await apiRequest('/api/admin/work-orders', {
            method: 'POST',
            body: JSON.stringify({
              clientName: row.clientName,
              clientType: row.clientType,
              propertyAddress: row.propertyAddress,
              city: row.city,
              state: row.state,
              zipCode: row.zipCode,
              county: row.county,
              serviceCategory: row.serviceCategory,
              serviceDescription: row.serviceDescription,
              priority: row.priority,
              estimatedBudget: row.estimatedBudget
            })
          });
          imported += 1;
        }
        await onImported?.();
        await loadMissingPlatformData();
        const msg = `Imported ${imported} new Work Order(s) from "${selectedTab}".`;
        setStatusNote(msg);
        onSuccess(msg);
      } else if (confirmAction.kind === 'import-vendors') {
        let imported = 0;
        for (const row of parsedImportVendors) {
          await apiRequest('/api/admin/vendors', {
            method: 'POST',
            body: JSON.stringify({
              companyName: row.companyName,
              contactPerson: row.contactPerson,
              email: row.email,
              phone: row.phone,
              coverageAreas: row.coverageAreas,
              serviceCategories: row.serviceCategories,
              aspenGroveAbc: row.aspenGroveAbc,
              insuranceInfo: row.insuranceInfo,
              applicationStatus: 'Pending'
            })
          });
          imported += 1;
        }
        await onImported?.();
        await loadMissingPlatformData();
        const msg = `Imported ${imported} new Vendor record(s) from "${selectedTab}".`;
        setStatusNote(msg);
        onSuccess(msg);
      }
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  if (!open) return null;

  const confirmDialogProps = (() => {
    const title = metadata?.title || 'Google Spreadsheet';
    if (!confirmAction) return { title: '', description: '', label: 'Confirm' };
    switch (confirmAction.kind) {
      case 'sync-work-orders':
        return {
          title: 'Overwrite Work Orders Tab?',
          description: `This will clear and update the "${DEFAULT_WORK_ORDERS_TAB}" tab inside "${title}" with ${workOrders.length} Work Order record(s).`,
          label: 'Confirm & Sync Work Orders'
        };
      case 'sync-vendors':
        return {
          title: 'Overwrite Vendor Portal Tabs?',
          description: `This will clear and update "${DEFAULT_VENDORS_TAB}" (${vendors.length} vendors) and "${DEFAULT_VENDOR_BIDS_TAB}" (${bids.length} bids) inside "${title}".`,
          label: 'Confirm & Sync Vendors'
        };
      case 'sync-all':
        return {
          title: 'Sync All Work Orders & Vendor Portal Tabs?',
          description: `This will overwrite "${DEFAULT_WORK_ORDERS_TAB}" (${workOrders.length}), "${DEFAULT_VENDORS_TAB}" (${vendors.length}), and "${DEFAULT_VENDOR_BIDS_TAB}" (${bids.length}) inside "${title}".`,
          label: 'Confirm Full Sync'
        };
      case 'import-work-orders':
        return {
          title: 'Import Work Orders from Google Sheets?',
          description: `Create ${confirmAction.count} new Work Order record(s) in the platform database from tab "${selectedTab}"?`,
          label: `Import ${confirmAction.count} Work Order(s)`
        };
      case 'import-vendors':
        return {
          title: 'Import Vendors from Google Sheets?',
          description: `Create ${confirmAction.count} new Vendor record(s) in the Vendor Portal database from tab "${selectedTab}"?`,
          label: `Import ${confirmAction.count} Vendor(s)`
        };
    }
  })();

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Google Sheets Sync"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="fixed inset-0 bg-emerald-950/60 backdrop-blur-xs" onClick={onClose} />
        <div className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-emerald-950/15 bg-white p-6 text-[#052E16] shadow-2xl dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-50">
          <div className="flex items-center justify-between border-b border-emerald-950/10 pb-3 dark:border-lime-300/15">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#BEF264] text-[#052E16]">
                <FileSpreadsheet className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display text-lg font-bold">
                  Google Sheets Sync — Work Orders &amp; Vendor Portal
                </h3>
                <p className="text-[11px] opacity-75">
                  Sync live Work Orders, Vendor Network profiles, and Vendor Bids directly with Google Sheets.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="rounded-md p-1 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {/* Step 1: Google Connection */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-950/12 bg-[#F6FAF1] p-4 dark:border-lime-300/15 dark:bg-[#041A0E]">
              <div>
                <p className="text-xs font-bold">1. Google Account Connection</p>
                <p className="mt-0.5 text-[11px] opacity-75">
                  {needsAuth
                    ? 'Sign in with Google to grant permission to read and update spreadsheets.'
                    : `Connected as ${googleEmail}`}
                </p>
              </div>

              {needsAuth ? (
                <GoogleSignInButton
                  onClick={handleGoogleSignIn}
                  disabled={authBusy}
                  label={authBusy ? 'Signing in...' : 'Sign in with Google'}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-lime-200/80 px-2.5 py-1 text-[11px] font-semibold text-[#052E16]">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                  </span>
                  <button
                    type="button"
                    onClick={handleGoogleSignOut}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-950/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-emerald-950/5 dark:border-lime-300/20 cursor-pointer"
                  >
                    <LogOut className="h-3 w-3" /> Sign Out
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-900 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-200"
              >
                {error}
              </div>
            )}

            {statusNote && (
              <div
                role="status"
                className="rounded-lg border border-emerald-700/25 bg-lime-100/70 px-3.5 py-2.5 text-xs font-semibold text-[#052E16] dark:border-lime-300/30 dark:bg-lime-400/15 dark:text-lime-200"
              >
                {statusNote}
              </div>
            )}

            {/* Step 2: Select or Create Spreadsheet */}
            <div className="space-y-3 rounded-xl border border-emerald-950/12 p-4 dark:border-lime-300/15">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold">2. Target Google Spreadsheet</p>
                <button
                  type="button"
                  disabled={needsAuth || busy}
                  onClick={handleCreateSpreadsheet}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-3 py-1.5 text-xs font-semibold text-[#BEF264] hover:bg-[#094724] disabled:opacity-50 dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  Create New Workbook
                </button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={sheetInput}
                  onChange={(e) => setSheetInput(e.target.value)}
                  placeholder="Paste Google Sheets URL or Spreadsheet ID..."
                  className="flex-1 rounded-lg border border-emerald-950/20 bg-white px-3 py-2 font-mono text-xs dark:border-lime-300/20 dark:bg-[#041A0E]"
                />
                <button
                  type="button"
                  disabled={needsAuth || busy || !sheetInput.trim()}
                  onClick={handleConnectExistingSheet}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-950/20 px-4 py-2 text-xs font-semibold hover:bg-lime-100 disabled:opacity-50 dark:border-lime-300/25 dark:hover:bg-white/10 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
                  Load Sheet Tabs
                </button>
              </div>

              {metadata && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F6FAF1] px-3 py-2 text-xs dark:bg-[#041A0E]">
                  <div>
                    <span className="font-bold">{metadata.title}</span>
                    <span className="ml-2 opacity-70">
                      Tabs: {metadata.sheets.map((s) => s.title).join(', ')}
                    </span>
                  </div>
                  <a
                    href={metadata.spreadsheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-emerald-800 underline dark:text-lime-300"
                  >
                    Open Sheet <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {/* Step 3: Push Data to Google Sheets */}
            <div className="space-y-3 rounded-xl border border-emerald-950/12 p-4 dark:border-lime-300/15">
              <p className="text-xs font-bold">3. Sync App Data → Google Sheets</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  disabled={needsAuth || !metadata || busy}
                  onClick={() => setConfirmAction({ kind: 'sync-work-orders' })}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold disabled:opacity-50 cursor-pointer ${
                    initialScope === 'work-orders'
                      ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                      : 'border border-emerald-950/20 hover:bg-lime-100 dark:border-lime-300/25 dark:hover:bg-white/10'
                  }`}
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  Sync Work Orders ({workOrders.length})
                </button>

                <button
                  type="button"
                  disabled={needsAuth || !metadata || busy}
                  onClick={() => setConfirmAction({ kind: 'sync-vendors' })}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold disabled:opacity-50 cursor-pointer ${
                    initialScope === 'vendors'
                      ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                      : 'border border-emerald-950/20 hover:bg-lime-100 dark:border-lime-300/25 dark:hover:bg-white/10'
                  }`}
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  Sync Vendors &amp; Bids ({vendors.length}/{bids.length})
                </button>

                <button
                  type="button"
                  disabled={needsAuth || !metadata || busy}
                  onClick={() => setConfirmAction({ kind: 'sync-all' })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-950/20 px-3 py-2.5 text-xs font-semibold hover:bg-lime-100 disabled:opacity-50 dark:border-lime-300/25 dark:hover:bg-white/10 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Sync All 3 Tabs
                </button>
              </div>
            </div>

            {/* Step 4: Read & Import Back from Google Sheets */}
            {metadata && metadata.sheets.length > 0 && (
              <div className="space-y-3 rounded-xl border border-emerald-950/12 p-4 dark:border-lime-300/15">
                <p className="text-xs font-bold">4. Read / Import from Google Sheets</p>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Select spreadsheet tab"
                    value={selectedTab}
                    onChange={(e) => {
                      setSelectedTab(e.target.value);
                      setPreviewRows(null);
                    }}
                    className="rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/20 dark:bg-[#041A0E]"
                  >
                    {metadata.sheets.map((s) => (
                      <option key={s.sheetId} value={s.title}>
                        {s.title}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={needsAuth || busy}
                    onClick={handleReadPreview}
                    className="rounded-lg border border-emerald-950/20 px-3.5 py-2 text-xs font-semibold hover:bg-lime-100 disabled:opacity-50 dark:border-lime-300/25 dark:hover:bg-white/10 cursor-pointer"
                  >
                    Preview Tab Data
                  </button>

                  {canWriteWorkOrders && parsedImportWorkOrders.length > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setConfirmAction({
                          kind: 'import-work-orders',
                          count: parsedImportWorkOrders.length
                        })
                      }
                      className="rounded-lg bg-[#052E16] px-3.5 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                    >
                      Import {parsedImportWorkOrders.length} New Work Order(s)
                    </button>
                  )}

                  {canWriteVendors && parsedImportVendors.length > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setConfirmAction({
                          kind: 'import-vendors',
                          count: parsedImportVendors.length
                        })
                      }
                      className="rounded-lg bg-[#052E16] px-3.5 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                    >
                      Import {parsedImportVendors.length} New Vendor(s)
                    </button>
                  )}
                </div>

                {previewRows && previewRows.length > 0 && (
                  <div className="max-h-56 overflow-auto rounded-lg border border-emerald-950/10 dark:border-lime-300/15">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-[#F6FAF1] font-semibold dark:bg-[#041A0E]">
                        <tr>
                          {previewRows[0].slice(0, 7).map((col, idx) => (
                            <th key={idx} className="px-2.5 py-2 whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                        {previewRows.slice(1, 26).map((r, rIdx) => (
                          <tr key={rIdx}>
                            {previewRows[0].slice(0, 7).map((_, cIdx) => (
                              <td key={cIdx} className="px-2.5 py-1.5 whitespace-nowrap">
                                {r[cIdx] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmDialogProps.title}
        description={confirmDialogProps.description}
        confirmLabel={confirmDialogProps.label}
        destructive={confirmAction?.kind === 'sync-work-orders' || confirmAction?.kind === 'sync-vendors' || confirmAction?.kind === 'sync-all'}
        loading={busy}
        onConfirm={() => void executeConfirmedAction()}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
};
