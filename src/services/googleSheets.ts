import type {
  ClientType,
  PriorityLevel,
  VendorBidEntity,
  VendorRecord,
  WorkOrderEntity
} from '../types/platform';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export const DEFAULT_WORK_ORDERS_TAB = 'Work Orders';
export const DEFAULT_VENDORS_TAB = 'Vendor Portal';
export const DEFAULT_VENDOR_BIDS_TAB = 'Vendor Bids';

export interface SheetTabInfo {
  sheetId: number;
  title: string;
  index: number;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: SheetTabInfo[];
}

export class GoogleSheetsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function extractSpreadsheetId(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  if (/^[a-zA-Z0-9-_]{15,120}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function quoteTabName(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`;
}

async function sheetsRequest<T>(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg =
      (data as { error?: { message?: string } })?.error?.message ||
      `Google Sheets request failed (${res.status})`;
    throw new GoogleSheetsApiError(errMsg, res.status);
  }
  return data as T;
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const fields = encodeURIComponent(
    'spreadsheetId,spreadsheetUrl,properties.title,sheets(properties(sheetId,title,index))'
  );
  const raw = await sheetsRequest<{
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number } }>;
  }>(`${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=${fields}`, accessToken);

  return {
    spreadsheetId: raw.spreadsheetId,
    title: raw.properties?.title || 'Untitled Spreadsheet',
    spreadsheetUrl:
      raw.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${raw.spreadsheetId}/edit`,
    sheets: (raw.sheets || [])
      .map((s) => ({
        sheetId: s.properties?.sheetId ?? 0,
        title: s.properties?.title || 'Sheet1',
        index: s.properties?.index ?? 0
      }))
      .sort((a, b) => a.index - b.index)
  };
}

export async function createWorkOrdersAndVendorSpreadsheet(
  accessToken: string,
  title = "Smoker's Lawn Care — Work Orders & Vendor Portal"
): Promise<SpreadsheetMetadata> {
  const created = await sheetsRequest<{
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number } }>;
  }>(SHEETS_API_BASE, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [
        {
          properties: {
            title: DEFAULT_WORK_ORDERS_TAB,
            index: 0,
            gridProperties: { frozenRowCount: 1 }
          }
        },
        {
          properties: {
            title: DEFAULT_VENDORS_TAB,
            index: 1,
            gridProperties: { frozenRowCount: 1 }
          }
        },
        {
          properties: {
            title: DEFAULT_VENDOR_BIDS_TAB,
            index: 2,
            gridProperties: { frozenRowCount: 1 }
          }
        }
      ]
    })
  });

  return {
    spreadsheetId: created.spreadsheetId,
    title: created.properties?.title || title,
    spreadsheetUrl:
      created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
    sheets: (created.sheets || []).map((s) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties?.title || DEFAULT_WORK_ORDERS_TAB,
      index: s.properties?.index ?? 0
    }))
  };
}

export async function ensureTabsExist(
  accessToken: string,
  spreadsheetId: string,
  desiredTitles: string[]
): Promise<SpreadsheetMetadata> {
  const meta = await getSpreadsheetMetadata(accessToken, spreadsheetId);
  const existing = new Set(meta.sheets.map((s) => s.title.toLowerCase()));
  const missing = desiredTitles.filter((t) => !existing.has(t.toLowerCase()));

  if (missing.length === 0) {
    return meta;
  }

  await sheetsRequest(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: missing.map((tabTitle) => ({
          addSheet: {
            properties: {
              title: tabTitle,
              gridProperties: { frozenRowCount: 1 }
            }
          }
        }))
      })
    }
  );

  return getSpreadsheetMetadata(accessToken, spreadsheetId);
}

async function replaceSheetValues(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  rows: (string | number)[][]
): Promise<number> {
  const clearRange = encodeURIComponent(`${quoteTabName(tabName)}!A:Z`);
  await sheetsRequest(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${clearRange}:clear`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({})
    }
  );

  const writeRange = encodeURIComponent(`${quoteTabName(tabName)}!A1`);
  await sheetsRequest(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${writeRange}?valueInputOption=RAW`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        range: `${quoteTabName(tabName)}!A1`,
        majorDimension: 'ROWS',
        values: rows
      })
    }
  );

  return Math.max(0, rows.length - 1);
}

export function buildWorkOrderRows(workOrders: WorkOrderEntity[]): (string | number)[][] {
  const headers = [
    'WO #',
    'Status',
    'Priority',
    'Service Category',
    'Scope Description',
    'Property Address',
    'City',
    'State',
    'ZIP',
    'County',
    'Client Name',
    'Client Type',
    'Assigned Vendor',
    'Estimated Budget',
    'Approved Budget',
    'SLA Deadline',
    'Updated At'
  ];

  const dataRows = workOrders.map((wo) => [
    wo.workOrderCode,
    wo.status,
    wo.priority,
    wo.serviceCategory,
    wo.serviceDescription,
    wo.propertyAddress,
    wo.city,
    wo.state,
    wo.zipCode,
    wo.county,
    wo.clientName,
    wo.clientType,
    wo.assignedVendorName || 'Unassigned',
    wo.estimatedBudget,
    wo.approvedBudget ?? '',
    wo.slaDeadline || '',
    wo.updatedAt
  ]);

  return [headers, ...dataRows];
}

export function buildVendorRows(vendors: VendorRecord[]): (string | number)[][] {
  const headers = [
    'Vendor #',
    'Company Name',
    'Contact Person',
    'Email',
    'Phone',
    'Coverage Areas',
    'Service Categories',
    'Aspen Grove ABC#',
    'Insurance Info',
    'Application Status',
    'Account Status',
    'Completed WOs',
    'Registration Date'
  ];

  const dataRows = vendors.map((v) => [
    v.vendorCode,
    v.companyName,
    v.contactPerson,
    v.email,
    v.phone,
    v.coverageAreas || '',
    v.serviceCategories.join('; '),
    v.aspenGroveAbc || '',
    v.insuranceInfo || '',
    v.applicationStatus,
    v.accountStatus,
    v.completedWorkOrders,
    v.registrationDate
  ]);

  return [headers, ...dataRows];
}

export function buildVendorBidRows(bids: VendorBidEntity[]): (string | number)[][] {
  const headers = [
    'Bid #',
    'WO #',
    'Vendor Name',
    'Aspen Grove ABC#',
    'Proposed Price',
    'Estimated Completion',
    'Bid Status',
    'Notes',
    'Submitted Date'
  ];

  const dataRows = bids.map((b) => [
    b.bidCode,
    b.workOrderCode,
    b.vendorName,
    b.aspenGroveAbc || '',
    b.proposedPrice,
    b.estimatedCompletionTime,
    b.status,
    b.bidNotes || '',
    b.submittedDate
  ]);

  return [headers, ...dataRows];
}

export async function syncWorkOrdersToSheet(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  workOrders: WorkOrderEntity[]
): Promise<{ count: number; metadata: SpreadsheetMetadata }> {
  const metadata = await ensureTabsExist(accessToken, spreadsheetId, [tabName]);
  const matchedTab =
    metadata.sheets.find((s) => s.title.toLowerCase() === tabName.toLowerCase())?.title || tabName;
  const count = await replaceSheetValues(
    accessToken,
    spreadsheetId,
    matchedTab,
    buildWorkOrderRows(workOrders)
  );
  return { count, metadata };
}

export async function syncVendorsAndBidsToSheet(
  accessToken: string,
  spreadsheetId: string,
  vendorsTabName: string,
  bidsTabName: string,
  vendors: VendorRecord[],
  bids: VendorBidEntity[]
): Promise<{ vendorCount: number; bidCount: number; metadata: SpreadsheetMetadata }> {
  const metadata = await ensureTabsExist(accessToken, spreadsheetId, [vendorsTabName, bidsTabName]);
  const actualVendorsTab =
    metadata.sheets.find((s) => s.title.toLowerCase() === vendorsTabName.toLowerCase())?.title ||
    vendorsTabName;
  const actualBidsTab =
    metadata.sheets.find((s) => s.title.toLowerCase() === bidsTabName.toLowerCase())?.title ||
    bidsTabName;

  const vendorCount = await replaceSheetValues(
    accessToken,
    spreadsheetId,
    actualVendorsTab,
    buildVendorRows(vendors)
  );
  const bidCount = await replaceSheetValues(
    accessToken,
    spreadsheetId,
    actualBidsTab,
    buildVendorBidRows(bids)
  );

  return { vendorCount, bidCount, metadata };
}

export interface FullGoogleSheetsSyncResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  workOrderCount: number;
  vendorCount: number;
  bidCount: number;
  metadata: SpreadsheetMetadata;
}

export async function syncWorkOrderAndVendorData(params: {
  accessToken: string;
  spreadsheetId?: string;
  workbookTitle?: string;
  workOrdersTabName?: string;
  vendorsTabName?: string;
  bidsTabName?: string;
  workOrders: WorkOrderEntity[];
  vendors: VendorRecord[];
  bids: VendorBidEntity[];
}): Promise<FullGoogleSheetsSyncResult> {
  const {
    accessToken,
    spreadsheetId,
    workbookTitle,
    workOrdersTabName = DEFAULT_WORK_ORDERS_TAB,
    vendorsTabName = DEFAULT_VENDORS_TAB,
    bidsTabName = DEFAULT_VENDOR_BIDS_TAB,
    workOrders,
    vendors,
    bids
  } = params;

  const targetMeta = spreadsheetId
    ? await ensureTabsExist(accessToken, spreadsheetId, [
        workOrdersTabName,
        vendorsTabName,
        bidsTabName
      ])
    : await createWorkOrdersAndVendorSpreadsheet(accessToken, workbookTitle);

  const woResult = await syncWorkOrdersToSheet(
    accessToken,
    targetMeta.spreadsheetId,
    workOrdersTabName,
    workOrders
  );
  const vendorResult = await syncVendorsAndBidsToSheet(
    accessToken,
    targetMeta.spreadsheetId,
    vendorsTabName,
    bidsTabName,
    vendors,
    bids
  );

  return {
    spreadsheetId: vendorResult.metadata.spreadsheetId,
    spreadsheetUrl: vendorResult.metadata.spreadsheetUrl,
    title: vendorResult.metadata.title,
    workOrderCount: woResult.count,
    vendorCount: vendorResult.vendorCount,
    bidCount: vendorResult.bidCount,
    metadata: vendorResult.metadata
  };
}

export async function readSheetRows(
  accessToken: string,
  spreadsheetId: string,
  tabName: string
): Promise<string[][]> {
  const range = encodeURIComponent(`${quoteTabName(tabName)}!A1:Z250`);
  const res = await sheetsRequest<{ values?: string[][] }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    accessToken
  );
  return res.values || [];
}

export interface ParsedWorkOrderImportRow {
  workOrderCode: string;
  priority: PriorityLevel;
  serviceCategory: string;
  serviceDescription: string;
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  county: string;
  clientName: string;
  clientType: ClientType;
  estimatedBudget: number;
}

export interface ParsedVendorImportRow {
  vendorCode: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  coverageAreas: string;
  serviceCategories: string[];
  aspenGroveAbc: string;
  insuranceInfo: string;
}

function normalizeHeader(value: string | undefined): string {
  return (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function findColIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalized.findIndex((h) => h === candidate || h.includes(candidate));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseWorkOrderSheetRows(
  rows: string[][],
  existingCodes: Set<string>
): ParsedWorkOrderImportRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const codeIdx = findColIndex(headers, ['wo', 'work order code', 'work order']);
  const prioIdx = findColIndex(headers, ['priority']);
  const catIdx = findColIndex(headers, ['service category', 'category']);
  const descIdx = findColIndex(headers, ['scope description', 'description', 'scope']);
  const addrIdx = findColIndex(headers, ['property address', 'address']);
  const cityIdx = findColIndex(headers, ['city']);
  const stateIdx = findColIndex(headers, ['state']);
  const zipIdx = findColIndex(headers, ['zip']);
  const countyIdx = findColIndex(headers, ['county']);
  const clientIdx = findColIndex(headers, ['client name', 'client']);
  const clientTypeIdx = findColIndex(headers, ['client type']);
  const budgetIdx = findColIndex(headers, ['estimated budget', 'budget']);

  if (addrIdx < 0 || cityIdx < 0 || stateIdx < 0) {
    return [];
  }

  const parsed: ParsedWorkOrderImportRow[] = [];
  for (const row of rows.slice(1)) {
    const code = codeIdx >= 0 ? (row[codeIdx] || '').trim() : '';
    if (code && existingCodes.has(code.toUpperCase())) continue;

    const propertyAddress = (row[addrIdx] || '').trim();
    const city = (row[cityIdx] || '').trim();
    const state = (row[stateIdx] || '').trim();
    if (!propertyAddress || !city || !state) continue;

    const rawPriority = prioIdx >= 0 ? (row[prioIdx] || '').trim() : '';
    const priority: PriorityLevel =
      rawPriority === 'Low' ||
      rawPriority === 'Normal' ||
      rawPriority === 'High' ||
      rawPriority === 'Urgent'
        ? rawPriority
        : 'Normal';

    const rawClientType = clientTypeIdx >= 0 ? (row[clientTypeIdx] || '').trim() : '';
    const clientType: ClientType =
      rawClientType === 'Mortgage Servicer' ||
      rawClientType === 'REO Asset Manager' ||
      rawClientType === 'Property Manager' ||
      rawClientType === 'Homeowner'
        ? rawClientType
        : 'Property Manager';

    const rawBudget = budgetIdx >= 0 ? Number(String(row[budgetIdx] || '0').replace(/[^0-9.]/g, '')) : 0;

    parsed.push({
      workOrderCode: code,
      priority,
      serviceCategory: (catIdx >= 0 && row[catIdx]?.trim()) || 'Property Preservation & Securing',
      serviceDescription:
        (descIdx >= 0 && row[descIdx]?.trim()) || 'Imported from Google Sheets',
      propertyAddress,
      city,
      state,
      zipCode: zipIdx >= 0 ? (row[zipIdx] || '').trim() : '',
      county: countyIdx >= 0 ? (row[countyIdx] || '').trim() : '',
      clientName: (clientIdx >= 0 && row[clientIdx]?.trim()) || 'Direct Portfolio',
      clientType,
      estimatedBudget: Number.isFinite(rawBudget) ? rawBudget : 0
    });
  }

  return parsed;
}

export function parseVendorSheetRows(
  rows: string[][],
  existingEmailsAndCodes: Set<string>
): ParsedVendorImportRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const codeIdx = findColIndex(headers, ['vendor', 'vendor code']);
  const companyIdx = findColIndex(headers, ['company name', 'company']);
  const contactIdx = findColIndex(headers, ['contact person', 'contact']);
  const emailIdx = findColIndex(headers, ['email']);
  const phoneIdx = findColIndex(headers, ['phone']);
  const covIdx = findColIndex(headers, ['coverage areas', 'coverage']);
  const catIdx = findColIndex(headers, ['service categories', 'trades', 'categories']);
  const abcIdx = findColIndex(headers, ['aspen grove abc', 'abc']);
  const insIdx = findColIndex(headers, ['insurance info', 'insurance']);

  if (companyIdx < 0 || emailIdx < 0) {
    return [];
  }

  const parsed: ParsedVendorImportRow[] = [];
  for (const row of rows.slice(1)) {
    const vendorCode = codeIdx >= 0 ? (row[codeIdx] || '').trim() : '';
    const companyName = (row[companyIdx] || '').trim();
    const email = (row[emailIdx] || '').trim().toLowerCase();
    if (!companyName || !email || !email.includes('@')) continue;
    if (
      existingEmailsAndCodes.has(email) ||
      (vendorCode && existingEmailsAndCodes.has(vendorCode.toUpperCase()))
    ) {
      continue;
    }

    const categoriesRaw = catIdx >= 0 ? (row[catIdx] || '').trim() : '';
    const serviceCategories = categoriesRaw
      ? categoriesRaw
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : ['Property Preservation', 'Lawn Maintenance'];

    parsed.push({
      vendorCode,
      companyName,
      contactPerson: (contactIdx >= 0 && row[contactIdx]?.trim()) || companyName,
      email,
      phone: (phoneIdx >= 0 && row[phoneIdx]?.trim()) || '000-000-0000',
      coverageAreas: covIdx >= 0 ? (row[covIdx] || '').trim() : '',
      serviceCategories,
      aspenGroveAbc: abcIdx >= 0 ? (row[abcIdx] || '').trim() : '',
      insuranceInfo: (insIdx >= 0 && row[insIdx]?.trim()) || '$2M GL / $1M E&O'
    });
  }

  return parsed;
}
