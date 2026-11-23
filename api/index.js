// server/app.ts
import "dotenv/config";
import express2 from "express";

// server/routes.ts
import express from "express";

// server/routes/authAndUsersRoutes.ts
import crypto4 from "node:crypto";

// src/types/platform.ts
var ALL_PERMISSION_KEYS = [
  "dashboard.view",
  "work_orders.read",
  "work_orders.write",
  "work_orders.delete",
  "work_orders.qc",
  "vendors.read",
  "vendors.write",
  "vendors.approve",
  "clients.read",
  "clients.write",
  "bid_requests.read",
  "bid_requests.write",
  "bid_requests.convert",
  "vendor_bids.read",
  "vendor_bids.decide",
  "dispatch.read",
  "dispatch.write",
  "services.manage",
  "gallery.manage",
  "coverage.manage",
  "reviews.manage",
  "messages.manage",
  "reports.view",
  "reports.export",
  "settings.manage",
  "admin_users.manage",
  "audit.view"
];
var WORK_ORDER_STATUSES = [
  "New",
  "Open Bid",
  "Bid Review",
  "Approved",
  "Dispatched",
  "Scheduled",
  "In Progress",
  "Submitted for QC",
  "QC Rejected",
  "QC Verified",
  "Completed",
  "Cancelled"
];
var PRIORITY_LEVELS = ["Low", "Normal", "High", "Urgent"];
var CLIENT_TYPES = [
  "Mortgage Servicer",
  "REO Asset Manager",
  "Property Manager",
  "Homeowner",
  "Other"
];
var VENDOR_APPLICATION_STATUSES = [
  "Pending",
  "Under Review",
  "Approved",
  "Rejected",
  "Suspended"
];
var BID_REQUEST_STATUSES = [
  "New",
  "Pending Review",
  "Contacted",
  "Estimating",
  "Proposal Sent",
  "Approved",
  "Converted",
  "Rejected",
  "Archived"
];
var DISPATCH_STATUSES = [
  "New",
  "Acknowledged",
  "Assigned",
  "En Route",
  "In Progress",
  "Resolved",
  "Closed"
];

// server/email.ts
function isEmailServiceConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}
async function sendTransactionalEmail(params) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    return {
      sent: false,
      reason: "Email provider is not configured (set RESEND_API_KEY and EMAIL_FROM)."
    };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text
      })
    });
    if (!response.ok) {
      return {
        sent: false,
        reason: `Email provider returned status ${response.status}`
      };
    }
    return { sent: true };
  } catch {
    return {
      sent: false,
      reason: "Failed to reach configured email provider."
    };
  }
}

// server/security.ts
import crypto from "node:crypto";
import path from "node:path";
var EPHEMERAL_SECRET = crypto.randomBytes(32).toString("hex");
function getSigningSecret() {
  const envSecret = cleanEnvValue(process.env.SESSION_SECRET);
  return envSecret && envSecret.length >= 16 ? envSecret : EPHEMERAL_SECRET;
}
function cleanEnvValue(raw) {
  if (!raw) return "";
  const trimmed = raw.trim();
  const wrapped = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return (wrapped ? wrapped[2] : trimmed).trim();
}
function getBootstrapConfig() {
  const secret = cleanEnvValue(process.env.ADMIN_BOOTSTRAP_SECRET);
  const rawEmail = cleanEnvValue(process.env.ADMIN_BOOTSTRAP_EMAIL);
  const allowedEmails = rawEmail.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return {
    secret,
    secretConfigured: Boolean(secret),
    allowedEmails,
    emailAllowlistConfigured: allowedEmails.length > 0
  };
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}
function verifyPassword(password, storedHash) {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, "hex");
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  } catch {
    return false;
  }
}
function signSessionToken(userId, email, ttlSeconds = 60 * 60 * 12) {
  const now = Math.floor(Date.now() / 1e3);
  const payload = {
    sub: userId,
    email,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + ttlSeconds
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSigningSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}
function verifySessionToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", getSigningSecret()).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!decoded.sub || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1e3)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
function sanitizeText(value, maxLen = 2e3) {
  if (typeof value !== "string") return "";
  return value.replace(/\0/g, "").trim().slice(0, maxLen);
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) && email.length <= 254;
}
function isSafeMediaUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
function resolveSafeFilePath(baseDir, ...segments) {
  const resolvedBase = path.resolve(baseDir);
  const cleanedSegments = segments.map((s) => path.basename(s));
  const resolvedTarget = path.resolve(resolvedBase, ...cleanedSegments);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedTarget;
}
function parseCookieHeader(cookieHeader) {
  const result = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}
function verifyMutationOrigin(req) {
  const xRequestedWith = req.headers["x-requested-with"];
  const headerVal = Array.isArray(xRequestedWith) ? xRequestedWith[0] : xRequestedWith;
  if (typeof headerVal === "string" && headerVal.toLowerCase() === "xmlhttprequest") return true;
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin);
      return parsedOrigin.host === host;
    } catch {
      return false;
    }
  }
  return false;
}
function securityHeadersMiddleware(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}
function createRateLimiter(maxRequests, windowMs) {
  const hits = /* @__PURE__ */ new Map();
  return (req, res, next) => {
    const forwarded = req.headers["x-forwarded-for"];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0])?.trim() || req.ip || "unknown";
    const key = `${ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const existing = hits.get(key);
    if (!existing || existing.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 5e3) {
        for (const [k, v] of hits.entries()) {
          if (v.resetAt <= now) hits.delete(k);
        }
      }
      next();
      return;
    }
    if (existing.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1e3));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Too many requests. Please wait a moment before trying again."
      });
      return;
    }
    existing.count += 1;
    next();
  };
}
function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
function rowsToCsv(headers, rows) {
  const headerLine = headers.map(csvEscape).join(",");
  const dataLines = rows.map((row) => row.map(csvEscape).join(","));
  return [headerLine, ...dataLines].join("\r\n");
}

// server/store.ts
import crypto2 from "node:crypto";
import fs from "node:fs";
import path2 from "node:path";

// src/data/servicesData.ts
var CORE_SERVICES = [
  {
    number: "01.",
    title: "Property Preservation & Securing",
    subtitle: "Full-lifecycle field preservation aligned with HUD, FHA, VA, and Fannie Mae mortgagee guidelines.",
    turnaround: "24\u201348 hr standard SLA",
    spanClass: "lg:col-span-2",
    items: [
      "Initial & recurring lock changes, re-keying, and lockbox installation",
      "Interior & exterior debris removal, trash-outs, and broom-swept cleanouts",
      "HUD-compliant window & door board-ups and structural securing",
      "Dry & wet winterization with pressure testing and antifreeze tagging",
      "Sump pump checks, roof tarping, and vacant property maintenance"
    ],
    complianceNote: "Photo-verified completion via GPS & date-stamped mobile reporting"
  },
  {
    number: "02.",
    title: "Lawn Care & Grounds Maintenance",
    subtitle: "Recurring bi-weekly cuts, initial overgrown clearing, and seasonal curb-appeal restoration.",
    turnaround: "48 hr initial cut",
    spanClass: "lg:col-span-1",
    items: [
      'Initial overgrown grass cutting (>12" clearing) and brush hogging',
      "Recurring bi-weekly mowing, string trimming, and hard-edge borders",
      "Shrub pruning, tree limb clearing, and gutter debris removal",
      "Snow removal, salting, and municipal code-violation abatement"
    ],
    complianceNote: "Municipal grass-height & HOA compliance guaranteed"
  },
  {
    number: "03.",
    title: "Handyman & REO Turnkey Repairs",
    subtitle: "Licensed trade repair crews handling make-ready turns, punch lists, and landlord maintenance.",
    turnaround: "72 hr bid-to-repair",
    spanClass: "lg:col-span-1",
    items: [
      "Drywall patching, texture matching, and interior/exterior painting",
      "Plumbing leak repairs, faucet/wax-ring replacements, and shut-offs",
      "Electrical troubleshooting, GFCI upgrades, and fixture installations",
      "Finish carpentry, subfloor repair, cabinet hardware, and door framing"
    ],
    complianceNote: "Uniform pricing aligned with RepairBase & Xactimate scopes"
  },
  {
    number: "04.",
    title: "Inspections & Emergency Storm Assessment",
    subtitle: "Rapid post-storm damage documentation, occupancy checks, and emergency hazard mitigation.",
    turnaround: "4\u201312 hr emergency dispatch",
    spanClass: "lg:col-span-2",
    items: [
      "Same-day occupancy verification & interior/exterior condition reports (PCR)",
      "Emergency storm tree removal, roof tarping, and water extraction dispatch",
      "FEMA/insurance-ready itemized bid scopes with high-res photo logs",
      "Mold remediation prep, basement pump-outs, and winter freeze-break mitigation"
    ],
    complianceNote: "24/7 emergency dispatch desk covering 38 U.S. states"
  }
];
var BEFORE_AFTER_CASES = [
  {
    id: "yard-restoration",
    title: "Vacant Asset Curb-Appeal & Debris Abatement",
    location: "Marion County, IN",
    workOrderId: "WO-88412-IN",
    scopeSummary: 'Cleared 14 cubic yards of storm brush, cut 22" overgrown turf, edged driveway, and secured front porch.',
    turnaroundHours: 36,
    beforeImage: "/src/assets/images/before_overgrown_yard_1794909182781.jpg",
    afterImage: "/src/assets/images/after_manicured_yard_1794909182832.jpg",
    beforeAlt: "Overgrown vacant residential yard with tall grass and fallen branches prior to property preservation",
    afterAlt: "Restored residential front lawn with freshly striped green turf, edged concrete driveway, and cleared walkway"
  },
  {
    id: "reo-interior",
    title: "REO Living Room Drywall, Trim & Floor Turn",
    location: "Franklin County, OH",
    workOrderId: "WO-88509-OH",
    scopeSummary: "Patched damaged plaster walls, primed and painted two coats, installed crisp baseboards, and refinished oak flooring.",
    turnaroundHours: 64,
    beforeImage: "/src/assets/images/before_reo_interior_1794909186324.jpg",
    afterImage: "/src/assets/images/after_reo_interior_1794909185210.jpg",
    beforeAlt: "Distressed vacant residential living room with scuffed drywall patches and worn hardwood floors",
    afterAlt: "Renovated clean living room interior with freshly painted smooth walls, trim, and polished hardwood floors"
  }
];
var SAMPLE_WORK_ORDERS = [
  {
    id: "SLC-26-4091",
    clientType: "Mortgage Servicer",
    serviceType: "Initial Secure + Lock Change + Winterization",
    cityState: "Indianapolis, IN",
    county: "Marion",
    status: "QC Verified",
    slaDue: "Completed in 28 hrs",
    estimatedBudget: 485,
    coordinates: { lat: 39.7684, lng: -86.1581 }
  },
  {
    id: "SLC-26-4104",
    clientType: "REO Asset Manager",
    serviceType: "18 Cu. Yd. Debris Trash-Out & Overgrown Cut",
    cityState: "Columbus, OH",
    county: "Franklin",
    status: "In Progress",
    slaDue: "Due in 14 hrs",
    estimatedBudget: 1120,
    coordinates: { lat: 39.9612, lng: -82.9988 }
  },
  {
    id: "SLC-26-4118",
    clientType: "Property Manager",
    serviceType: "Drywall Patch, Interior Paint & GFCI Swap",
    cityState: "Louisville, KY",
    county: "Jefferson",
    status: "Dispatched",
    slaDue: "Due in 32 hrs",
    estimatedBudget: 740,
    coordinates: { lat: 38.2527, lng: -85.7585 }
  },
  {
    id: "SLC-26-4129",
    clientType: "REO Asset Manager",
    serviceType: "Emergency Roof Tarp & Fallen Limb Removal",
    cityState: "Charlotte, NC",
    county: "Mecklenburg",
    status: "Open Bid",
    slaDue: "Bid window: 6 hrs",
    estimatedBudget: 950,
    coordinates: { lat: 35.2271, lng: -80.8431 }
  },
  {
    id: "SLC-26-4135",
    clientType: "Homeowner",
    serviceType: "Bi-Weekly Lawn Care & Shrub Trimming",
    cityState: "Nashville, TN",
    county: "Davidson",
    status: "Open Bid",
    slaDue: "Bid window: 24 hrs",
    estimatedBudget: 185,
    coordinates: { lat: 36.1627, lng: -86.7816 }
  }
];
var COVERAGE_REGIONS = [
  {
    region: "Midwest Operations Hub",
    hubCity: "Indianapolis, IN",
    states: ["IN", "OH", "IL", "MI", "KY", "MO", "WI", "MN"],
    activeCounties: 312,
    avgDispatchHours: 18,
    hudStandard: "HUD ML 2022-07 & Winterization Protocols",
    coordinates: { lat: 39.7684, lng: -86.1581 },
    isHeadquarters: true
  },
  {
    region: "Southeast & Gulf Corridor",
    hubCity: "Charlotte, NC",
    states: ["NC", "SC", "GA", "TN", "FL", "AL", "VA", "TX"],
    activeCounties: 428,
    avgDispatchHours: 22,
    hudStandard: "FEMA/HUD Storm Mitigation & Lawn Abatement",
    coordinates: { lat: 35.2271, lng: -80.8431 }
  },
  {
    region: "Northeast & Mid-Atlantic",
    hubCity: "Pittsburgh, PA",
    states: ["PA", "NJ", "NY", "MD", "DE", "CT", "MA"],
    activeCounties: 194,
    avgDispatchHours: 24,
    hudStandard: "Municipal Code & Freeze-Protection Standards",
    coordinates: { lat: 40.4406, lng: -79.9959 }
  },
  {
    region: "West & Mountain States",
    hubCity: "Phoenix, AZ",
    states: ["AZ", "CO", "NV", "UT", "TX", "WA", "OR"],
    activeCounties: 165,
    avgDispatchHours: 26,
    hudStandard: "Xeriscape Maintenance & REO Securing",
    coordinates: { lat: 33.4484, lng: -112.074 }
  }
];
var GOOGLE_PROFILE_INFO = {
  businessName: "Smoker's Lawn Care Service LLC",
  address: "13306 Caine Ave, Cleveland, OH 44105",
  phone: "(800) 555-0194",
  email: "Smokeslawncare@gmail.com",
  hours: "Mon\u2013Sat 7:00 AM \u2013 7:00 PM EST \xB7 24/7 Emergency Dispatch",
  rating: 4.9,
  reviewCount: 284,
  googleMapsProfileUrl: "https://www.google.com/maps/search/?api=1&query=Smokers+Lawn+Care+Service+LLC+Indianapolis+IN"
};
var GOOGLE_REVIEWS = [
  {
    id: "rev-1",
    reviewer: "Rachel Vance",
    role: "Regional Asset Manager",
    organization: "Heartland REO Servicing",
    rating: 5,
    dateLabel: "2 weeks ago",
    serviceTag: "Property Preservation & Winterization",
    comment: "We migrated 140 vacant Indiana and Ohio properties to Smoker\u2019s Lawn Care Service LLC after repeated missed cut windows elsewhere. Before-and-after GPS photo sets arrive within 36 hours and pass HUD audit review on the first pass."
  },
  {
    id: "rev-2",
    reviewer: "Marcus Delgado",
    role: "Director of Field Operations",
    organization: "Keystone SFR Portfolio",
    rating: 5,
    dateLabel: "1 month ago",
    serviceTag: "REO Handyman & Make-Ready Turns",
    comment: "Their handyman crews turned 9 rental units in Louisville ahead of lease-up. Drywall patches, lock re-keys, and overgrown yard cleanups were completed under one work order without separate vendor markups."
  },
  {
    id: "rev-3",
    reviewer: "Denise Whitaker",
    role: "Homeowner",
    organization: "Marion County Residence",
    rating: 5,
    dateLabel: "1 month ago",
    serviceTag: "Emergency Storm Cleanup & Lawn Care",
    comment: "After severe wind downed two limbs onto our porch, their dispatch team arrived the same afternoon, cleared the debris cleanly, and kept our lawn edged all summer. Transparent pricing and zero surprises."
  }
];

// server/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";
var cachedSupabaseAdmin = null;
var cachedSupabaseKey = "";
function normalizeSupabaseUrl(raw) {
  let cleaned = cleanEnvValue(raw);
  if (!cleaned) return null;
  if (/^[a-z0-9-]+\.supabase\.(co|in|net)$/i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  try {
    const parsed = new URL(cleaned);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname) {
      return cleaned;
    }
  } catch {
    return null;
  }
  return null;
}
function getRawServerSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}
function getSupabaseConfigDiagnostics() {
  const rawUrl = getRawServerSupabaseUrl();
  const normalized = normalizeSupabaseUrl(rawUrl);
  const serviceKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = cleanEnvValue(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  return {
    urlConfigured: Boolean(cleanEnvValue(rawUrl)),
    urlValid: Boolean(normalized),
    serviceKeyConfigured: Boolean(serviceKey),
    anonKeyConfigured: Boolean(anonKey)
  };
}
function isProductionEnvironment() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}
function isServerSupabaseConfigured() {
  const url = normalizeSupabaseUrl(getRawServerSupabaseUrl());
  const serviceKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return Boolean(url && serviceKey);
}
function getSupabaseAdminClient() {
  const url = normalizeSupabaseUrl(getRawServerSupabaseUrl());
  const serviceKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) return null;
  const cacheKey = `${url}|${serviceKey}`;
  if (!cachedSupabaseAdmin || cachedSupabaseKey !== cacheKey) {
    try {
      cachedSupabaseAdmin = createClient(url, serviceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      cachedSupabaseKey = cacheKey;
    } catch {
      return null;
    }
  }
  return cachedSupabaseAdmin;
}
function getSupabaseAnonClient() {
  const url = normalizeSupabaseUrl(getRawServerSupabaseUrl());
  const anonKey = cleanEnvValue(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  if (!url || !anonKey) return null;
  try {
    return createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  } catch {
    return null;
  }
}

// server/store.ts
var DATA_DIR = path2.resolve(process.cwd(), "data");
var DB_FILE = path2.join(DATA_DIR, "platform-db.json");
var UPLOADS_ROOT = path2.resolve(process.cwd(), "uploads");
var DEFAULT_ROLES = [
  {
    role: "Super Admin",
    description: "Full platform authority including RBAC, admin invitations, and settings.",
    permissions: [
      "dashboard.view",
      "work_orders.read",
      "work_orders.write",
      "work_orders.delete",
      "work_orders.qc",
      "vendors.read",
      "vendors.write",
      "vendors.approve",
      "clients.read",
      "clients.write",
      "bid_requests.read",
      "bid_requests.write",
      "bid_requests.convert",
      "vendor_bids.read",
      "vendor_bids.decide",
      "dispatch.read",
      "dispatch.write",
      "services.manage",
      "gallery.manage",
      "coverage.manage",
      "reviews.manage",
      "messages.manage",
      "reports.view",
      "reports.export",
      "settings.manage",
      "admin_users.manage",
      "audit.view"
    ]
  },
  {
    role: "Admin",
    description: "Operational oversight across work orders, vendors, clients, and CMS.",
    permissions: [
      "dashboard.view",
      "work_orders.read",
      "work_orders.write",
      "work_orders.delete",
      "work_orders.qc",
      "vendors.read",
      "vendors.write",
      "vendors.approve",
      "clients.read",
      "clients.write",
      "bid_requests.read",
      "bid_requests.write",
      "bid_requests.convert",
      "vendor_bids.read",
      "vendor_bids.decide",
      "dispatch.read",
      "dispatch.write",
      "services.manage",
      "gallery.manage",
      "coverage.manage",
      "reviews.manage",
      "messages.manage",
      "reports.view",
      "reports.export",
      "settings.manage",
      "audit.view"
    ]
  },
  {
    role: "Operations Manager",
    description: "Manages work orders, QC reviews, urgent dispatch, and coverage.",
    permissions: [
      "dashboard.view",
      "work_orders.read",
      "work_orders.write",
      "work_orders.qc",
      "vendors.read",
      "clients.read",
      "bid_requests.read",
      "bid_requests.convert",
      "vendor_bids.read",
      "vendor_bids.decide",
      "dispatch.read",
      "dispatch.write",
      "coverage.manage",
      "reports.view"
    ]
  },
  {
    role: "Vendor Manager",
    description: "Approves vendors, monitors compliance docs, and awards bids.",
    permissions: [
      "dashboard.view",
      "vendors.read",
      "vendors.write",
      "vendors.approve",
      "vendor_bids.read",
      "vendor_bids.decide",
      "work_orders.read",
      "reports.view"
    ]
  },
  {
    role: "Support Manager",
    description: "Handles bid requests, client messages, reviews, and reporting.",
    permissions: [
      "dashboard.view",
      "clients.read",
      "clients.write",
      "bid_requests.read",
      "bid_requests.write",
      "dispatch.read",
      "dispatch.write",
      "messages.manage",
      "reviews.manage",
      "reports.view"
    ]
  }
];
function hoursFromNowIso(hours) {
  return new Date(Date.now() + hours * 3600 * 1e3).toISOString();
}
function daysAgoIso(days) {
  return new Date(Date.now() - days * 86400 * 1e3).toISOString();
}
function buildInitialState() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const demoClients = [
    {
      id: "cli-demo-1",
      clientCode: "CLI-1001",
      companyName: "Heartland Mortgage Servicing",
      contactName: "Rachel Vance",
      email: "assetops@heartlandreo.example",
      phone: "(317) 555-0142",
      clientType: "Mortgage Servicer",
      address: "200 N Illinois St, Indianapolis, IN 46204",
      notes: "Primary Midwest HUD preservation portfolio (demo record).",
      accountStatus: "active",
      isDemo: true,
      createdAt: daysAgoIso(28),
      updatedAt: now
    },
    {
      id: "cli-demo-2",
      clientCode: "CLI-1002",
      companyName: "Keystone SFR Portfolio",
      contactName: "Marcus Delgado",
      email: "fieldops@keystonesfr.example",
      phone: "(502) 555-0199",
      clientType: "Property Manager",
      address: "401 W Main St, Louisville, KY 40202",
      notes: "REO make-ready & handyman turn account (demo record).",
      accountStatus: "active",
      isDemo: true,
      createdAt: daysAgoIso(18),
      updatedAt: now
    }
  ];
  const demoVendors = [
    {
      id: "vnd-demo-1",
      vendorCode: "VND-20410",
      companyName: "Hoosier Field Preservation LLC",
      contactPerson: "Caleb Dawson",
      email: "dispatch@hoosierfield.example",
      phone: "(317) 555-0164",
      address: "1240 S Meridian St",
      city: "Indianapolis",
      state: "IN",
      zipCode: "46225",
      serviceCategories: ["Lawn Maintenance", "Debris Removal", "Winterization"],
      coverageAreas: "IN, OH, KY",
      counties: ["Marion", "Hamilton", "Franklin"],
      licenseInfo: "IN-CONTR-88412",
      insuranceInfo: "$2M GL / $1M E&O Verified",
      aspenGroveAbc: "ABC-882410",
      applicationStatus: "Approved",
      accountStatus: "active",
      rating: 4.9,
      completedWorkOrders: 42,
      notes: "Preferred Midwest winterization & securing crew (demo record).",
      isDemo: true,
      registrationDate: daysAgoIso(45),
      updatedAt: now
    },
    {
      id: "vnd-demo-2",
      vendorCode: "VND-20419",
      companyName: "Piedmont Exterior & Storm Pros",
      contactPerson: "Elena Brooks",
      email: "ops@piedmontpros.example",
      phone: "(704) 555-0133",
      address: "890 Tryon Rd",
      city: "Charlotte",
      state: "NC",
      zipCode: "28202",
      serviceCategories: ["Lock Changes & Boarding", "Debris Removal", "Drywall & Painting"],
      coverageAreas: "NC, SC, TN",
      counties: ["Mecklenburg", "Davidson"],
      licenseInfo: "NC-GC-44901",
      insuranceInfo: "$2M GL Verified",
      aspenGroveAbc: "ABC-904112",
      applicationStatus: "Pending",
      accountStatus: "pending",
      rating: null,
      completedWorkOrders: 0,
      notes: "Awaiting W-9 and COI expiration confirmation (demo record).",
      isDemo: true,
      registrationDate: daysAgoIso(2),
      updatedAt: now
    }
  ];
  const services = CORE_SERVICES.map((svc, idx) => ({
    id: `svc-demo-${idx + 1}`,
    serviceNumber: svc.number,
    slug: svc.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    title: svc.title,
    subtitle: svc.subtitle,
    category: svc.title,
    pricingModel: idx === 1 ? "Per Lot Tier / Recurring" : idx === 2 ? "Time & Materials / Xactimate" : "HUD Allowable / Turnkey",
    basePrice: idx === 0 ? 350 : idx === 1 ? 125 : idx === 2 ? 240 : 295,
    turnaround: svc.turnaround,
    items: [...svc.items],
    complianceNote: svc.complianceNote,
    imageUrl: "",
    isVisible: true,
    sortOrder: idx + 1,
    isArchived: false,
    isDemo: true,
    updatedAt: now
  }));
  const galleryCases = BEFORE_AFTER_CASES.map((g, idx) => ({
    id: `gal-demo-${idx + 1}`,
    slug: g.id,
    title: g.title,
    location: g.location,
    workOrderId: g.workOrderId,
    scopeSummary: g.scopeSummary,
    turnaroundHours: g.turnaroundHours,
    beforeImage: g.beforeImage,
    afterImage: g.afterImage,
    beforeAlt: g.beforeAlt,
    afterAlt: g.afterAlt,
    isPublished: true,
    sortOrder: idx + 1,
    isDemo: true,
    updatedAt: now
  }));
  const coverageRegions = COVERAGE_REGIONS.map((r, idx) => ({
    id: `cov-demo-${idx + 1}`,
    region: r.region,
    hubCity: r.hubCity,
    states: [...r.states],
    counties: [],
    activeCounties: r.activeCounties,
    avgDispatchHours: r.avgDispatchHours,
    hudStandard: r.hudStandard,
    lat: r.coordinates.lat,
    lng: r.coordinates.lng,
    isHeadquarters: Boolean(r.isHeadquarters),
    coverageStatus: "Active",
    isPublished: true,
    isDemo: true,
    updatedAt: now
  }));
  const workOrders = SAMPLE_WORK_ORDERS.map((wo, idx) => {
    const [city, state] = wo.cityState.split(",").map((s) => s.trim());
    return {
      id: `wo-demo-${idx + 1}`,
      workOrderCode: wo.id,
      clientId: idx === 0 ? "cli-demo-1" : idx === 2 ? "cli-demo-2" : null,
      clientName: idx === 0 ? "Heartland Mortgage Servicing" : idx === 2 ? "Keystone SFR Portfolio" : `${wo.clientType} Account`,
      clientType: wo.clientType,
      propertyAddress: `${1100 + idx * 315} Oakridge Pkwy`,
      city: city || "Indianapolis",
      state: state || "IN",
      zipCode: `4620${idx + 1}`,
      county: wo.county,
      lat: wo.coordinates.lat,
      lng: wo.coordinates.lng,
      serviceCategory: idx === 0 ? "Property Preservation & Securing" : idx === 1 ? "Property Preservation & Securing" : idx === 2 ? "Handyman & REO Turnkey Repairs" : idx === 3 ? "Inspections & Emergency Storm Assessment" : "Lawn Care & Grounds Maintenance",
      serviceDescription: wo.serviceType,
      priority: idx === 3 ? "Urgent" : idx < 2 ? "High" : "Normal",
      estimatedBudget: wo.estimatedBudget,
      approvedBudget: wo.status === "QC Verified" || wo.status === "In Progress" ? wo.estimatedBudget : null,
      assignedVendorId: idx < 3 ? "vnd-demo-1" : null,
      assignedVendorName: idx < 3 ? "Hoosier Field Preservation LLC" : "",
      createdDate: daysAgoIso(5 - idx),
      scheduledDate: hoursFromNowIso(12 + idx * 6),
      slaDeadline: idx === 0 ? daysAgoIso(1) : hoursFromNowIso(6 + idx * 10),
      completionDate: wo.status === "QC Verified" ? daysAgoIso(1) : null,
      status: wo.status,
      qcNotes: wo.status === "QC Verified" ? "GPS timestamped photo log verified against HUD ML 2022-07." : "",
      isArchived: false,
      isDemo: true,
      updatedAt: now
    };
  });
  const reviews = GOOGLE_REVIEWS.map((rev, idx) => ({
    id: `rev-demo-${idx + 1}`,
    reviewer: rev.reviewer,
    organization: rev.organization,
    role: rev.role,
    rating: rev.rating,
    comment: rev.comment,
    serviceTag: rev.serviceTag,
    dateLabel: rev.dateLabel,
    isVerifiedCustomer: false,
    publicationStatus: "Published",
    sortOrder: idx + 1,
    isDemo: true,
    createdAt: daysAgoIso(10 + idx * 7)
  }));
  const timeline = workOrders.map((wo) => ({
    id: crypto2.randomUUID(),
    workOrderId: wo.id,
    actorName: "System Demo Seed",
    eventType: "created",
    description: `Demo work order ${wo.workOrderCode} initialized with status ${wo.status}.`,
    createdAt: wo.createdDate
  }));
  const vendorBids = [
    {
      id: "bid-demo-1",
      bidCode: "BID-30112",
      workOrderId: "wo-demo-4",
      workOrderCode: "SLC-26-4129",
      vendorId: "vnd-demo-2",
      vendorName: "Piedmont Exterior & Storm Pros",
      aspenGroveAbc: "ABC-904112",
      proposedPrice: 890,
      estimatedCompletionTime: "6 Hours",
      bidNotes: "2-person roof tarping & chainsaw crew staged in Charlotte.",
      attachments: [],
      status: "Submitted",
      clarificationNote: "",
      submittedDate: daysAgoIso(1),
      updatedAt: now
    }
  ];
  return {
    seededAt: now,
    roles: JSON.parse(JSON.stringify(DEFAULT_ROLES)),
    admins: [],
    passwordResets: [],
    revokedJtis: [],
    activityLogs: [],
    clients: demoClients,
    clientProperties: [
      {
        id: "prop-demo-1",
        clientId: "cli-demo-1",
        address: "4120 N Meridian St",
        city: "Indianapolis",
        state: "IN",
        zipCode: "46208",
        county: "Marion",
        lat: 39.7684,
        lng: -86.1581,
        occupancyStatus: "Vacant",
        lockboxCode: "4490",
        notes: "Demo REO asset property.",
        createdAt: daysAgoIso(20)
      }
    ],
    vendors: demoVendors,
    vendorDocuments: [],
    services,
    workOrders,
    workOrderNotes: [],
    workOrderAttachments: [],
    workOrderTimeline: timeline,
    bidRequests: [],
    vendorBids,
    dispatchRequests: [],
    galleryCases,
    coverageRegions,
    reviews,
    messages: [],
    notifications: [],
    notificationPreferences: {},
    businessSettings: {
      businessName: GOOGLE_PROFILE_INFO.businessName,
      phone: "(217) 394-6440",
      email: GOOGLE_PROFILE_INFO.email,
      address: GOOGLE_PROFILE_INFO.address,
      hours: GOOGLE_PROFILE_INFO.hours,
      logoUrl: "",
      defaultWoPriority: "Normal",
      defaultSlaHours: 48,
      autoNotifyUrgent: true,
      coverageRadiusNote: "38 U.S. States \xB7 1,099+ Active Counties",
      googleProfileUrl: GOOGLE_PROFILE_INFO.googleMapsProfileUrl,
      googleRating: GOOGLE_PROFILE_INFO.rating,
      googleReviewCount: GOOGLE_PROFILE_INFO.reviewCount,
      updatedAt: now
    }
  };
}
var cachedState = null;
function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const bucket of ["gallery", "work-order-attachments", "vendor-documents", "dispatch-attachments"]) {
    fs.mkdirSync(path2.join(UPLOADS_ROOT, bucket), { recursive: true });
  }
}
function getDbState() {
  if (isProductionEnvironment()) {
    throw new Error(
      "Local JSON persistence (data/platform-db.json) is disabled in production. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  if (cachedState) return cachedState;
  ensureDirectories();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.roles) && Array.isArray(parsed.workOrders)) {
        cachedState = parsed;
        return cachedState;
      }
    } catch {
    }
  }
  cachedState = buildInitialState();
  saveDbState(cachedState);
  return cachedState;
}
function saveDbState(state) {
  if (isProductionEnvironment()) {
    throw new Error(
      "Local JSON persistence (data/platform-db.json) is disabled in production. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  ensureDirectories();
  cachedState = state;
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmpFile, DB_FILE);
}
function getPermissionsForRole(state, roleName) {
  if (roleName === "Super Admin") {
    return [...DEFAULT_ROLES[0].permissions];
  }
  const found = state.roles.find((r) => r.role === roleName);
  return found ? [...found.permissions] : [];
}
function appendActivityLog(state, entry) {
  state.activityLogs.unshift({
    id: crypto2.randomUUID(),
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (state.activityLogs.length > 2e3) {
    state.activityLogs.length = 2e3;
  }
}
function appendNotification(state, notif) {
  state.notifications.unshift({
    id: crypto2.randomUUID(),
    eventType: notif.eventType,
    title: notif.title,
    message: notif.message,
    entityType: notif.entityType,
    entityId: notif.entityId,
    isRead: false,
    recipientRole: notif.recipientRole || "All Admins",
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (state.notifications.length > 500) {
    state.notifications.length = 500;
  }
}
function appendWorkOrderTimeline(state, workOrderId, actorName, eventType, description) {
  state.workOrderTimeline.unshift({
    id: crypto2.randomUUID(),
    workOrderId,
    actorName,
    eventType,
    description,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}

// server/routes/shared.ts
import crypto3 from "node:crypto";
import fs2 from "node:fs";
import path3 from "node:path";
import multer from "multer";
var SESSION_COOKIE_NAME = "slc_admin_session";
var ALLOWED_IMAGE_MIMES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp"]);
var ALLOWED_DOC_MIMES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain"
]);
function makeMulterUploader(allowedMimes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 4 },
    fileFilter: (_req, file, cb) => {
      if (allowedMimes.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Unsupported file type. Allowed: JPG, PNG, WEBP, PDF, TXT."));
      }
    }
  });
}
var uploadImageMiddleware = makeMulterUploader(ALLOWED_IMAGE_MIMES);
var uploadAttachmentMiddleware = makeMulterUploader(ALLOWED_DOC_MIMES);
var bootstrapLockChain = Promise.resolve();
async function runWithBootstrapLock(task) {
  const prev = bootstrapLockChain;
  let release;
  bootstrapLockChain = new Promise((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await task();
  } finally {
    release();
  }
}
async function persistUploadedFile(bucket, file) {
  const ext = path3.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "") || ".bin";
  const safeName = `${Date.now()}-${crypto3.randomUUID().slice(0, 8)}${ext}`;
  const sb = getSupabaseAdminClient();
  if (sb) {
    const { error } = await sb.storage.from(bucket).upload(safeName, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });
    if (error) {
      throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }
    if (bucket === "gallery") {
      const { data } = sb.storage.from(bucket).getPublicUrl(safeName);
      return { storagePath: safeName, publicUrl: data.publicUrl };
    }
    return { storagePath: safeName };
  }
  if (isProductionEnvironment()) {
    throw new Error("File storage requires Supabase in production; local disk uploads are disabled.");
  }
  const destPath = resolveSafeFilePath(UPLOADS_ROOT, bucket, safeName);
  if (!destPath) {
    throw new Error("Invalid destination path");
  }
  fs2.mkdirSync(path3.dirname(destPath), { recursive: true });
  fs2.writeFileSync(destPath, file.buffer);
  return {
    storagePath: safeName,
    publicUrl: bucket === "gallery" ? `/uploads/gallery/${safeName}` : void 0
  };
}
async function ensureSupabaseSystemRoles(sb) {
  const { data: existingRoles } = await sb.from("admin_roles").select("id, name, description");
  const byName = /* @__PURE__ */ new Map();
  for (const row of existingRoles ?? []) {
    byName.set(row.name, {
      id: row.id,
      name: row.name,
      description: row.description ?? ""
    });
  }
  const newlyCreatedRoles = /* @__PURE__ */ new Set();
  for (const def of DEFAULT_ROLES) {
    if (!byName.has(def.role)) {
      const { data: inserted } = await sb.from("admin_roles").upsert(
        { name: def.role, description: def.description, is_system: true },
        { onConflict: "name" }
      ).select("id, name, description").single();
      if (inserted) {
        newlyCreatedRoles.add(def.role);
        byName.set(def.role, {
          id: inserted.id,
          name: inserted.name,
          description: inserted.description ?? def.description
        });
      }
    }
  }
  const { count: totalPermRows } = await sb.from("role_permissions").select("id", { count: "exact", head: true });
  const shouldSeedAllDefaults = (totalPermRows ?? 0) === 0;
  for (const def of DEFAULT_ROLES) {
    const roleRow = byName.get(def.role);
    if (!roleRow || def.permissions.length === 0) continue;
    if (shouldSeedAllDefaults || newlyCreatedRoles.has(def.role)) {
      await sb.from("role_permissions").upsert(
        def.permissions.map((perm) => ({
          role_id: roleRow.id,
          permission_key: perm,
          allowed: true
        })),
        { onConflict: "role_id,permission_key" }
      );
    }
  }
  return Array.from(byName.values());
}
async function insertSupabaseAuditLog(sb, entry) {
  try {
    await sb.from("admin_activity_logs").insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail,
      actor_role: entry.actorRole,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      summary: entry.summary
    });
  } catch {
  }
}
function setSessionCookie(req, res, token, maxAgeSeconds = 60 * 60 * 12) {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.max(60, Math.floor(maxAgeSeconds))}`
  ];
  if (isHttps) {
    parts.push("Secure", "SameSite=None", "Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearSessionCookie(req, res) {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const parts = [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "Max-Age=0"];
  if (isHttps) {
    parts.push("Secure", "SameSite=None", "Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}
function extractRoleRelation(rawRel) {
  if (!rawRel) return null;
  const candidate = Array.isArray(rawRel) ? rawRel[0] : rawRel;
  if (candidate && typeof candidate === "object" && "id" in candidate && "name" in candidate) {
    return candidate;
  }
  return null;
}
async function loadSupabaseAdminProfile(sb, userId, options) {
  const { data: profile, error: profErr } = await sb.from("profiles").select(
    "id, email, full_name, phone, avatar_url, role_id, is_admin, account_status, last_login_at, created_at, admin_roles(id, name)"
  ).eq("id", userId).maybeSingle();
  if (profErr) {
    return {
      ok: false,
      status: 500,
      error: `Unable to verify administrator profile in Supabase: ${profErr.message}`
    };
  }
  if (!profile) {
    return {
      ok: false,
      status: 403,
      error: "Authenticated in Supabase, but no administrator profile exists for this account yet. Ask a Super Admin to add you under Admin Users or complete First Super Admin Setup."
    };
  }
  if (!profile.is_admin) {
    return {
      ok: false,
      status: 403,
      error: "This account does not have administrator privileges."
    };
  }
  let accountStatus = profile.account_status;
  if (accountStatus === "suspended") {
    return {
      ok: false,
      status: 403,
      error: "This administrator account is currently suspended."
    };
  }
  if (accountStatus === "invited") {
    if (options?.activateInvitedIfConfirmed && options?.authUserConfirmed) {
      await sb.from("profiles").update({ account_status: "active", last_login_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", profile.id);
      accountStatus = "active";
    } else {
      return {
        ok: false,
        status: 403,
        error: "This administrator invitation has not been activated yet. Use your invite link to set your password first."
      };
    }
  }
  if (accountStatus !== "active") {
    return {
      ok: false,
      status: 403,
      error: "This administrator account is currently inactive."
    };
  }
  let roleRel = extractRoleRelation(profile.admin_roles);
  if (!roleRel && profile.role_id) {
    const { data: roleRow } = await sb.from("admin_roles").select("id, name").eq("id", profile.role_id).maybeSingle();
    if (roleRow) {
      roleRel = { id: roleRow.id, name: roleRow.name };
    }
  }
  if (!roleRel) {
    return {
      ok: false,
      status: 403,
      error: "No valid administrator role is assigned to this account."
    };
  }
  const roleName = roleRel.name;
  let permissions = [];
  if (roleName === "Super Admin") {
    permissions = [...ALL_PERMISSION_KEYS];
  } else {
    const { data: perms } = await sb.from("role_permissions").select("permission_key, allowed").eq("role_id", roleRel.id).eq("allowed", true);
    permissions = (perms ?? []).map((p) => p.permission_key);
    if (permissions.length === 0) {
      const { count: anyPerms } = await sb.from("role_permissions").select("id", { count: "exact", head: true });
      if ((anyPerms ?? 0) === 0) {
        await ensureSupabaseSystemRoles(sb);
        const { data: seededPerms } = await sb.from("role_permissions").select("permission_key, allowed").eq("role_id", roleRel.id).eq("allowed", true);
        permissions = (seededPerms ?? []).map((p) => p.permission_key);
      }
    }
  }
  return {
    ok: true,
    user: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      phone: profile.phone ?? "",
      avatarUrl: profile.avatar_url ?? "",
      role: roleName,
      accountStatus,
      permissions,
      lastLoginAt: profile.last_login_at,
      createdAt: profile.created_at
    }
  };
}
async function resolveAdminAuthResult(req) {
  const authHeader = req.headers.authorization;
  let token = "";
  let usedCookie = false;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookieHeader(req.headers.cookie);
    if (cookies[SESSION_COOKIE_NAME]) {
      token = cookies[SESSION_COOKIE_NAME];
      usedCookie = true;
    }
  }
  if (!token) {
    return { ok: false, status: 401, error: "Authentication required. Please sign in to the Admin Portal." };
  }
  if (usedCookie && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase())) {
    if (!verifyMutationOrigin(req)) {
      return {
        ok: false,
        status: 403,
        error: "Session origin verification failed. Please refresh and sign in again."
      };
    }
  }
  const sb = getSupabaseAdminClient();
  if (sb && token.split(".").length === 3) {
    const { data: userData, error } = await sb.auth.getUser(token);
    if (error || !userData?.user) {
      return {
        ok: false,
        status: 401,
        error: "Your Supabase session is invalid or has expired. Please sign in again."
      };
    }
    const authUserConfirmed = Boolean(
      userData.user.email_confirmed_at || userData.user.confirmed_at || userData.user.last_sign_in_at
    );
    return loadSupabaseAdminProfile(sb, userData.user.id, {
      activateInvitedIfConfirmed: true,
      authUserConfirmed
    });
  }
  if (sb || isProductionEnvironment()) {
    return {
      ok: false,
      status: 401,
      error: "A valid Supabase session token is required. Please sign in again."
    };
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    return {
      ok: false,
      status: 401,
      error: "Your administrator session has expired or is invalid. Please sign in again."
    };
  }
  const state = getDbState();
  if (state.revokedJtis.includes(payload.jti)) {
    return {
      ok: false,
      status: 401,
      error: "This session has been signed out. Please sign in again."
    };
  }
  const admin = state.admins.find((a) => a.id === payload.sub);
  if (!admin) {
    return {
      ok: false,
      status: 403,
      error: "Administrator account not found."
    };
  }
  if (admin.accountStatus !== "active") {
    return {
      ok: false,
      status: 403,
      error: "This administrator account is currently suspended or inactive."
    };
  }
  return {
    ok: true,
    jti: payload.jti,
    user: {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      phone: admin.phone,
      avatarUrl: admin.avatarUrl,
      role: admin.role,
      accountStatus: admin.accountStatus,
      permissions: getPermissionsForRole(state, admin.role),
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt
    }
  };
}
async function resolveAdminFromRequest(req) {
  const result = await resolveAdminAuthResult(req);
  return result.ok ? { user: result.user, jti: result.jti } : null;
}
async function requireAdmin(req, res, next) {
  try {
    const resolved = await resolveAdminAuthResult(req);
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    req.adminUser = resolved.user;
    req.sessionJti = resolved.jti;
    next();
  } catch (err) {
    next(err);
  }
}
function requirePermission(perm) {
  return (req, res, next) => {
    const user = req.adminUser;
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (user.role !== "Super Admin" && !user.permissions.includes(perm)) {
      res.status(403).json({ error: `Insufficient permissions (${perm}).` });
      return;
    }
    next();
  };
}
function computeDateCutoff(range, fromStr, toStr) {
  const now = Date.now();
  if (range === "today") {
    const d = /* @__PURE__ */ new Date();
    d.setHours(0, 0, 0, 0);
    return { start: d.getTime(), end: now };
  }
  if (range === "7d") return { start: now - 7 * 86400 * 1e3, end: now };
  if (range === "30d") return { start: now - 30 * 86400 * 1e3, end: now };
  if (range === "90d") return { start: now - 90 * 86400 * 1e3, end: now };
  if (range === "custom" && fromStr) {
    const start = new Date(fromStr).getTime();
    const end = toStr ? new Date(toStr).getTime() + 86399999 : now;
    if (!Number.isNaN(start)) {
      return { start, end: Number.isNaN(end) ? now : end };
    }
  }
  return { start: 0, end: now + 365 * 86400 * 1e3 };
}

// server/routes/authAndUsersRoutes.ts
function registerAuthAndUsersRoutes(router) {
  const authLimiter = createRateLimiter(15, 15 * 60 * 1e3);
  router.get("/admin/auth/status", async (_req, res) => {
    const bootstrap = getBootstrapConfig();
    const bootstrapConfigured = bootstrap.secretConfigured;
    const requiresBootstrapEmail = bootstrap.emailAllowlistConfigured;
    const diag = getSupabaseConfigDiagnostics();
    const supabaseUrlInvalid = diag.urlConfigured && !diag.urlValid;
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { count, error } = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
        if (error) {
          res.json({
            needsFirstAdminSetup: true,
            authMode: "supabase",
            emailConfigured: true,
            bootstrapConfigured,
            requiresBootstrapSecret: true,
            requiresBootstrapEmail,
            supabaseUrlInvalid,
            anonKeyConfigured: diag.anonKeyConfigured,
            supabaseWarning: `Supabase profiles table check returned: ${error.message}`
          });
          return;
        }
        res.json({
          needsFirstAdminSetup: (count ?? 0) === 0,
          authMode: "supabase",
          emailConfigured: true,
          bootstrapConfigured,
          requiresBootstrapSecret: true,
          requiresBootstrapEmail,
          supabaseUrlInvalid,
          anonKeyConfigured: diag.anonKeyConfigured
        });
        return;
      } catch (err) {
        res.json({
          needsFirstAdminSetup: true,
          authMode: "supabase",
          emailConfigured: true,
          bootstrapConfigured,
          requiresBootstrapSecret: true,
          requiresBootstrapEmail,
          supabaseUrlInvalid,
          anonKeyConfigured: diag.anonKeyConfigured,
          supabaseWarning: err instanceof Error ? err.message : "Unable to reach Supabase."
        });
        return;
      }
    }
    if (isProductionEnvironment()) {
      res.json({
        needsFirstAdminSetup: false,
        authMode: "unconfigured",
        emailConfigured: isEmailServiceConfigured(),
        bootstrapConfigured,
        requiresBootstrapSecret: true,
        requiresBootstrapEmail,
        supabaseUrlInvalid,
        anonKeyConfigured: diag.anonKeyConfigured,
        productionConfigError: "Supabase server credentials (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) are required in production. Local JSON persistence (data/platform-db.json) is disabled."
      });
      return;
    }
    const db = getDbState();
    res.json({
      needsFirstAdminSetup: db.admins.length === 0,
      authMode: "local",
      emailConfigured: isEmailServiceConfigured(),
      bootstrapConfigured,
      requiresBootstrapSecret: true,
      requiresBootstrapEmail,
      supabaseUrlInvalid,
      anonKeyConfigured: diag.anonKeyConfigured
    });
  });
  router.post("/admin/auth/setup-first-admin", authLimiter, async (req, res) => {
    const fullName = sanitizeText(req.body?.fullName, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const bootstrapSecret = sanitizeText(req.body?.bootstrapSecret, 500);
    const bootstrap = getBootstrapConfig();
    if (!bootstrap.secretConfigured) {
      res.status(403).json({
        error: "First-admin setup is locked until ADMIN_BOOTSTRAP_SECRET is configured on the server by the project owner."
      });
      return;
    }
    const providedBuf = Buffer.from(bootstrapSecret, "utf8");
    const expectedBuf = Buffer.from(bootstrap.secret, "utf8");
    if (providedBuf.length !== expectedBuf.length || !crypto4.timingSafeEqual(providedBuf, expectedBuf)) {
      res.status(403).json({ error: "Invalid server setup secret." });
      return;
    }
    if (bootstrap.emailAllowlistConfigured && !bootstrap.allowedEmails.includes(email)) {
      res.status(403).json({
        error: "This email address is not authorized by ADMIN_BOOTSTRAP_EMAIL to claim the initial Super Admin."
      });
      return;
    }
    if (!fullName || !isValidEmail(email) || password.length < 10) {
      res.status(400).json({
        error: "Provide a full name, valid email address, and password of at least 10 characters."
      });
      return;
    }
    await runWithBootstrapLock(async () => {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { count, error: countErr } = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
        if (countErr) {
          res.status(500).json({
            error: `Unable to verify Supabase admin table (${countErr.message}). Confirm migrations 001\u2013004 have been executed.`
          });
          return;
        }
        if ((count ?? 0) > 0) {
          res.status(409).json({
            error: "First administrator has already been established. This one-time setup is permanently locked."
          });
          return;
        }
        const roles = await ensureSupabaseSystemRoles(sb);
        const superRole = roles.find((r) => r.name === "Super Admin");
        if (!superRole) {
          res.status(500).json({ error: "Super Admin role record is missing in admin_roles." });
          return;
        }
        let userId = "";
        let createdNewAuthUser = false;
        const { data: createdAuth, error: authErr } = await sb.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName }
        });
        if (createdAuth?.user && !authErr) {
          userId = createdAuth.user.id;
          createdNewAuthUser = true;
        } else {
          const alreadyExists = authErr?.message?.toLowerCase().includes("already") || authErr?.message?.toLowerCase().includes("registered") || authErr?.status === 422;
          if (alreadyExists) {
            const sbAnon = getSupabaseAnonClient();
            if (sbAnon) {
              const { data: existingSignIn, error: existingErr } = await sbAnon.auth.signInWithPassword({
                email,
                password
              });
              if (!existingErr && existingSignIn.user) {
                userId = existingSignIn.user.id;
              }
            }
            if (!userId) {
              res.status(400).json({
                error: "A Supabase Authentication user with this email already exists with a different password (or unlinked state). Enter that account\u2019s existing password or remove the unlinked user in Supabase Dashboard \u2192 Authentication \u2192 Users and retry."
              });
              return;
            }
          } else {
            res.status(400).json({ error: authErr?.message || "Unable to create Supabase admin user." });
            return;
          }
        }
        const rollbackIfNew = async () => {
          if (createdNewAuthUser && userId) {
            await sb.auth.admin.deleteUser(userId);
          }
        };
        const { data: claimed, error: claimErr } = await sb.rpc("claim_first_super_admin", {
          p_user_id: userId,
          p_email: email,
          p_full_name: fullName
        });
        let usedFallbackInsert = false;
        if (claimErr) {
          const isMissingRpc = claimErr.code === "PGRST202" || claimErr.message.includes("claim_first_super_admin") || claimErr.message.includes("does not exist");
          if (isMissingRpc) {
            usedFallbackInsert = true;
            const now2 = (/* @__PURE__ */ new Date()).toISOString();
            const { error: upsertErr } = await sb.from("profiles").upsert({
              id: userId,
              email,
              full_name: fullName,
              role_id: superRole.id,
              is_admin: true,
              account_status: "active",
              last_login_at: now2
            });
            if (upsertErr) {
              await rollbackIfNew();
              res.status(500).json({
                error: `Failed to assign Super Admin profile in Supabase: ${upsertErr.message}`
              });
              return;
            }
            const { count: postCount } = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
            if ((postCount ?? 0) > 1) {
              await sb.from("profiles").delete().eq("id", userId);
              await rollbackIfNew();
              res.status(409).json({
                error: "First administrator was claimed concurrently. This one-time setup is permanently locked."
              });
              return;
            }
          } else {
            await rollbackIfNew();
            res.status(500).json({
              error: `Failed to atomically claim Super Admin in Supabase: ${claimErr.message}`
            });
            return;
          }
        } else {
          const claimRow = Array.isArray(claimed) ? claimed[0] : claimed;
          const didClaim = typeof claimRow === "boolean" ? claimRow : Boolean(claimRow && typeof claimRow === "object" && claimRow.claimed);
          if (!didClaim) {
            await rollbackIfNew();
            res.status(409).json({
              error: "First administrator has already been established. This one-time setup is permanently locked."
            });
            return;
          }
        }
        if (usedFallbackInsert) {
          await insertSupabaseAuditLog(sb, {
            actorId: userId,
            actorEmail: email,
            actorRole: "Super Admin",
            action: "first_admin_claimed",
            entityType: "admin_user",
            entityId: userId,
            summary: `Initial Super Admin account established for ${email}.`
          });
        }
        res.status(201).json({
          setupComplete: true,
          authMode: "supabase",
          message: "First Super Admin account created and verified in Supabase. Setup is now permanently locked."
        });
        return;
      }
      if (isProductionEnvironment()) {
        res.status(503).json({
          error: "Supabase is required in production before creating the first Super Admin."
        });
        return;
      }
      const db = getDbState();
      if (db.admins.length > 0) {
        res.status(409).json({
          error: "First administrator has already been established. This one-time setup is permanently locked."
        });
        return;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const adminId = crypto4.randomUUID();
      db.admins.push({
        id: adminId,
        email,
        fullName,
        phone: "",
        avatarUrl: "",
        role: "Super Admin",
        accountStatus: "active",
        passwordHash: hashPassword(password),
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now
      });
      appendActivityLog(db, {
        actorId: adminId,
        actorEmail: email,
        actorRole: "Super Admin",
        action: "first_admin_claimed",
        entityType: "admin_user",
        entityId: adminId,
        summary: `Initial Super Admin account claimed for ${email}.`
      });
      saveDbState(db);
      const token = signSessionToken(adminId, email);
      setSessionCookie(req, res, token);
      res.status(201).json({
        setupComplete: true,
        authMode: "local",
        token,
        user: {
          id: adminId,
          email,
          fullName,
          phone: "",
          avatarUrl: "",
          role: "Super Admin",
          accountStatus: "active",
          permissions: getPermissionsForRole(db, "Super Admin"),
          lastLoginAt: now,
          createdAt: now
        }
      });
    });
  });
  router.post("/admin/auth/session", requireAdmin, async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const sb = getSupabaseAdminClient();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (sb && req.adminUser) {
      await sb.from("profiles").update({ last_login_at: now }).eq("id", req.adminUser.id);
      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "admin_login",
        entityType: "admin_user",
        entityId: req.adminUser.id,
        summary: `${req.adminUser.fullName} (${req.adminUser.role}) signed in.`
      });
    }
    if (token) {
      setSessionCookie(req, res, token, 3600);
    }
    res.json({ user: { ...req.adminUser, lastLoginAt: now } });
  });
  router.post("/admin/auth/login", authLimiter, async (req, res) => {
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!isValidEmail(email) || !password) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }
    const sb = getSupabaseAdminClient();
    if (sb) {
      const sbAnon = getSupabaseAnonClient();
      if (!sbAnon) {
        res.status(500).json({
          error: "Supabase server mode is enabled, but VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is not configured for password sign-in."
        });
        return;
      }
      const { data: signInData, error: signInErr } = await sbAnon.auth.signInWithPassword({
        email,
        password
      });
      if (signInErr || !signInData.session?.access_token || !signInData.user) {
        const msg = signInErr?.message?.toLowerCase() ?? "";
        if (msg.includes("email not confirmed")) {
          res.status(403).json({
            error: "Your email address has not been confirmed in Supabase Auth yet. Check your inbox or confirm the user in Supabase Dashboard."
          });
          return;
        }
        res.status(401).json({ error: "Invalid email or password." });
        return;
      }
      const profileResult = await loadSupabaseAdminProfile(sb, signInData.user.id, {
        activateInvitedIfConfirmed: true,
        authUserConfirmed: true
      });
      if (!profileResult.ok) {
        res.status(profileResult.status).json({ error: profileResult.error });
        return;
      }
      const user = profileResult.user;
      const now2 = (/* @__PURE__ */ new Date()).toISOString();
      await sb.from("profiles").update({ last_login_at: now2 }).eq("id", user.id);
      await insertSupabaseAuditLog(sb, {
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: "admin_login",
        entityType: "admin_user",
        entityId: user.id,
        summary: `${user.fullName} (${user.role}) signed in.`
      });
      setSessionCookie(
        req,
        res,
        signInData.session.access_token,
        signInData.session.expires_in ?? 3600
      );
      res.json({
        token: signInData.session.access_token,
        user: {
          ...user,
          lastLoginAt: now2
        }
      });
      return;
    }
    const db = getDbState();
    const admin = db.admins.find((a) => a.email.toLowerCase() === email);
    if (!admin || !verifyPassword(password, admin.passwordHash)) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    if (admin.accountStatus !== "active") {
      res.status(403).json({ error: "This administrator account is currently suspended or inactive." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    admin.lastLoginAt = now;
    admin.updatedAt = now;
    appendActivityLog(db, {
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: "admin_login",
      entityType: "admin_user",
      entityId: admin.id,
      summary: `${admin.fullName} (${admin.role}) signed in.`
    });
    saveDbState(db);
    const token = signSessionToken(admin.id, admin.email);
    setSessionCookie(req, res, token);
    res.json({
      token,
      user: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        phone: admin.phone,
        avatarUrl: admin.avatarUrl,
        role: admin.role,
        accountStatus: admin.accountStatus,
        permissions: getPermissionsForRole(db, admin.role),
        lastLoginAt: admin.lastLoginAt,
        createdAt: admin.createdAt
      }
    });
  });
  router.post("/admin/auth/logout", async (req, res) => {
    const resolved = await resolveAdminFromRequest(req);
    if (resolved?.jti && !getSupabaseAdminClient() && !isProductionEnvironment()) {
      const db = getDbState();
      db.revokedJtis.push(resolved.jti);
      if (db.revokedJtis.length > 5e3) {
        db.revokedJtis.splice(0, db.revokedJtis.length - 5e3);
      }
      saveDbState(db);
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });
  router.get("/admin/auth/me", requireAdmin, (req, res) => {
    res.json({ user: req.adminUser });
  });
  router.post("/admin/auth/forgot-password", authLimiter, async (req, res) => {
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "Please enter a valid email address." });
      return;
    }
    const baseUrl = process.env.APP_URL?.trim() || `${req.protocol}://${req.get("host")}`;
    const sb = getSupabaseAdminClient();
    if (sb) {
      const sbAnon = getSupabaseAnonClient();
      if (sbAnon) {
        await sbAnon.auth.resetPasswordForEmail(email, {
          redirectTo: `${baseUrl.replace(/\/$/, "")}/admin/reset-password`
        });
        res.json({
          message: "If an administrator account matches that email, Supabase has sent a password reset link.",
          emailSent: true
        });
        return;
      }
      res.json({
        message: "Supabase anon key is not configured for self-service reset emails.",
        emailSent: false
      });
      return;
    }
    const db = getDbState();
    const admin = db.admins.find((a) => a.email.toLowerCase() === email);
    if (!admin) {
      res.json({
        message: "If an administrator account matches that email, reset instructions have been processed.",
        emailSent: false
      });
      return;
    }
    const rawToken = crypto4.randomBytes(24).toString("hex");
    const tokenHash = crypto4.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1e3).toISOString();
    db.passwordResets.push({
      id: crypto4.randomUUID(),
      adminId: admin.id,
      tokenHash,
      expiresAt,
      used: false,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    saveDbState(db);
    const resetUrl = `${baseUrl.replace(/\/$/, "")}/admin/reset-password?token=${rawToken}`;
    const mailResult = await sendTransactionalEmail({
      to: admin.email,
      subject: "Smoker's Lawn Care Admin \u2014 Password Reset",
      text: `Use this link within 30 minutes to reset your Admin Portal password:

${resetUrl}`
    });
    if (mailResult.sent) {
      res.json({
        message: "Password reset link has been sent to your administrator email address.",
        emailSent: true
      });
      return;
    }
    res.json({
      message: "No transactional email provider (RESEND_API_KEY) is configured on this server, so no email was sent.",
      emailSent: false,
      emailReason: mailResult.reason
    });
  });
  router.post("/admin/auth/reset-password", authLimiter, (req, res) => {
    if (getSupabaseAdminClient()) {
      res.status(400).json({
        error: "Password recovery in Supabase mode uses the recovery link sent to your email."
      });
      return;
    }
    const token = sanitizeText(req.body?.token, 200);
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!token || newPassword.length < 10) {
      res.status(400).json({ error: "Valid reset token and new password (10+ characters) are required." });
      return;
    }
    const tokenHash = crypto4.createHash("sha256").update(token).digest("hex");
    const db = getDbState();
    const record = db.passwordResets.find(
      (r) => r.tokenHash === tokenHash && !r.used && new Date(r.expiresAt).getTime() > Date.now()
    );
    if (!record) {
      res.status(400).json({ error: "Reset token is invalid or has expired." });
      return;
    }
    const admin = db.admins.find((a) => a.id === record.adminId);
    if (!admin) {
      res.status(404).json({ error: "Administrator account not found." });
      return;
    }
    record.used = true;
    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    appendActivityLog(db, {
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: "password_reset_completed",
      entityType: "admin_user",
      entityId: admin.id,
      summary: `Password reset completed for ${admin.email}.`
    });
    saveDbState(db);
    res.json({ ok: true, message: "Password updated. You can now sign in." });
  });
  router.post("/admin/auth/change-password", requireAdmin, async (req, res) => {
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!currentPassword || newPassword.length < 10) {
      res.status(400).json({ error: "Current password and new password (10+ characters) are required." });
      return;
    }
    const sb = getSupabaseAdminClient();
    if (sb) {
      const sbAnon = getSupabaseAnonClient();
      if (!sbAnon) {
        res.status(500).json({
          error: "Supabase anon key is required to verify your current password before updating."
        });
        return;
      }
      const { error: verifyErr } = await sbAnon.auth.signInWithPassword({
        email: req.adminUser.email,
        password: currentPassword
      });
      if (verifyErr) {
        res.status(401).json({ error: "Current password is incorrect." });
        return;
      }
      const { error: updateErr } = await sb.auth.admin.updateUserById(req.adminUser.id, {
        password: newPassword
      });
      if (updateErr) {
        res.status(500).json({ error: `Unable to update password: ${updateErr.message}` });
        return;
      }
      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "password_changed",
        entityType: "admin_user",
        entityId: req.adminUser.id,
        summary: `Administrator ${req.adminUser.email} changed their password.`
      });
      res.json({ ok: true });
      return;
    }
    const db = getDbState();
    const admin = db.admins.find((a) => a.id === req.adminUser.id);
    if (!admin || !verifyPassword(currentPassword, admin.passwordHash)) {
      res.status(401).json({ error: "Current password is incorrect." });
      return;
    }
    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    appendActivityLog(db, {
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: "password_changed",
      entityType: "admin_user",
      entityId: admin.id,
      summary: `Administrator ${admin.email} changed their password.`
    });
    saveDbState(db);
    res.json({ ok: true });
  });
  router.get("/admin/users", requireAdmin, requirePermission("admin_users.manage"), async (_req, res) => {
    const sb = getSupabaseAdminClient();
    if (sb) {
      const roles = await ensureSupabaseSystemRoles(sb);
      const { data: permRows } = await sb.from("role_permissions").select("role_id, permission_key, allowed").eq("allowed", true);
      const permsByRoleId = /* @__PURE__ */ new Map();
      for (const p of permRows ?? []) {
        const list = permsByRoleId.get(p.role_id) ?? [];
        list.push(p.permission_key);
        permsByRoleId.set(p.role_id, list);
      }
      const roleConfigs = DEFAULT_ROLES.map((def) => {
        const dbRole = roles.find((r) => r.name === def.role);
        return {
          role: def.role,
          description: dbRole?.description || def.description,
          permissions: def.role === "Super Admin" ? [...ALL_PERMISSION_KEYS] : dbRole ? permsByRoleId.get(dbRole.id) ?? def.permissions : def.permissions
        };
      });
      const { data: profileRows, error: profErr } = await sb.from("profiles").select("id, email, full_name, phone, avatar_url, account_status, last_login_at, created_at, admin_roles(id, name)").eq("is_admin", true).order("created_at", { ascending: true });
      if (profErr) {
        res.status(500).json({ error: `Unable to load administrators: ${profErr.message}` });
        return;
      }
      const items = (profileRows ?? []).map((p) => {
        const roleRel = extractRoleRelation(p.admin_roles);
        const roleName = roleRel?.name ?? "Admin";
        const perms = roleName === "Super Admin" ? [...ALL_PERMISSION_KEYS] : roleRel?.id ? permsByRoleId.get(roleRel.id) ?? [] : [];
        return {
          id: p.id,
          email: p.email,
          fullName: p.full_name,
          phone: p.phone ?? "",
          avatarUrl: p.avatar_url ?? "",
          role: roleName,
          accountStatus: p.account_status,
          permissions: perms,
          lastLoginAt: p.last_login_at,
          createdAt: p.created_at
        };
      });
      res.json({ items, roles: roleConfigs, allPermissionKeys: ALL_PERMISSION_KEYS, authMode: "supabase" });
      return;
    }
    const db = getDbState();
    const users = db.admins.map((a) => ({
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      phone: a.phone,
      avatarUrl: a.avatarUrl,
      role: a.role,
      accountStatus: a.accountStatus,
      permissions: getPermissionsForRole(db, a.role),
      lastLoginAt: a.lastLoginAt,
      createdAt: a.createdAt
    }));
    res.json({ items: users, roles: db.roles, allPermissionKeys: ALL_PERMISSION_KEYS, authMode: "local" });
  });
  router.post("/admin/users", requireAdmin, requirePermission("admin_users.manage"), async (req, res) => {
    const fullName = sanitizeText(req.body?.fullName, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const phone = sanitizeText(req.body?.phone, 40);
    const role = sanitizeText(req.body?.role, 40);
    const inviteMode = req.body?.inviteMode === "email" ? "email" : "password";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const validRole = DEFAULT_ROLES.some((r) => r.role === role);
    if (!fullName || !isValidEmail(email) || !validRole) {
      res.status(400).json({ error: "Full name, valid email address, and valid administrator role are required." });
      return;
    }
    const sb = getSupabaseAdminClient();
    if (sb) {
      if (inviteMode === "password" && password.length < 10) {
        res.status(400).json({ error: "Initial password must be at least 10 characters when creating directly." });
        return;
      }
      const { data: existingProfile } = await sb.from("profiles").select("id, is_admin").eq("email", email).maybeSingle();
      if (existingProfile?.is_admin) {
        res.status(409).json({ error: "An administrator with that email already exists." });
        return;
      }
      const roles = await ensureSupabaseSystemRoles(sb);
      const roleRow = roles.find((r) => r.name === role);
      if (!roleRow) {
        res.status(400).json({ error: "Selected role could not be resolved." });
        return;
      }
      const baseUrl = process.env.APP_URL?.trim() || `${req.protocol}://${req.get("host")}`;
      let userId = existingProfile?.id ?? "";
      let createdNewAuthUser = false;
      let accountStatus = "active";
      if (!userId) {
        if (inviteMode === "email") {
          const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName },
            redirectTo: `${baseUrl.replace(/\/$/, "")}/admin/reset-password`
          });
          if (inviteErr || !invited.user) {
            const msg = inviteErr?.message || "Unable to send Supabase invitation email.";
            res.status(400).json({
              error: msg.toLowerCase().includes("already") ? "A user with this email already exists in Supabase Auth without an admin profile. Remove the unlinked user in Supabase Authentication or create directly." : msg
            });
            return;
          }
          userId = invited.user.id;
          createdNewAuthUser = true;
          accountStatus = "invited";
        } else {
          const { data: created, error: createErr } = await sb.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName }
          });
          if (createErr || !created.user) {
            const msg = createErr?.message || "Unable to create Supabase user.";
            res.status(400).json({
              error: msg.toLowerCase().includes("already") ? "A user with this email already exists in Supabase Auth without an admin profile. Remove the unlinked user in Supabase Authentication before re-adding." : msg
            });
            return;
          }
          userId = created.user.id;
          createdNewAuthUser = true;
          accountStatus = "active";
        }
      }
      const { error: upsertErr } = await sb.from("profiles").upsert({
        id: userId,
        email,
        full_name: fullName,
        phone,
        role_id: roleRow.id,
        is_admin: true,
        account_status: accountStatus
      });
      if (upsertErr) {
        if (createdNewAuthUser) {
          await sb.auth.admin.deleteUser(userId);
        }
        res.status(500).json({ error: `Unable to save administrator profile: ${upsertErr.message}` });
        return;
      }
      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: inviteMode === "email" ? "admin_user_invited" : "admin_user_created",
        entityType: "admin_user",
        entityId: userId,
        summary: `${inviteMode === "email" ? "Invited" : "Created"} admin ${email} with role ${role}.`
      });
      const { data: permRows } = await sb.from("role_permissions").select("permission_key").eq("role_id", roleRow.id).eq("allowed", true);
      res.status(201).json({
        item: {
          id: userId,
          email,
          fullName,
          phone,
          avatarUrl: "",
          role,
          accountStatus,
          permissions: role === "Super Admin" ? [...ALL_PERMISSION_KEYS] : (permRows ?? []).map((p) => p.permission_key),
          lastLoginAt: null,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      return;
    }
    if (password.length < 10) {
      res.status(400).json({ error: "Initial password (10+ characters) is required in local server mode." });
      return;
    }
    const db = getDbState();
    if (db.admins.some((a) => a.email.toLowerCase() === email)) {
      res.status(409).json({ error: "An administrator with that email already exists." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const newAdmin = {
      id: crypto4.randomUUID(),
      email,
      fullName,
      phone,
      avatarUrl: "",
      role,
      accountStatus: "active",
      passwordHash: hashPassword(password),
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now
    };
    db.admins.push(newAdmin);
    appendActivityLog(db, {
      actorId: req.adminUser.id,
      actorEmail: req.adminUser.email,
      actorRole: req.adminUser.role,
      action: "admin_user_invited",
      entityType: "admin_user",
      entityId: newAdmin.id,
      summary: `Created admin account ${email} with role ${role}.`
    });
    saveDbState(db);
    res.status(201).json({
      item: {
        id: newAdmin.id,
        email: newAdmin.email,
        fullName: newAdmin.fullName,
        phone: newAdmin.phone,
        avatarUrl: newAdmin.avatarUrl,
        role: newAdmin.role,
        accountStatus: newAdmin.accountStatus,
        permissions: getPermissionsForRole(db, newAdmin.role),
        lastLoginAt: newAdmin.lastLoginAt,
        createdAt: newAdmin.createdAt
      }
    });
  });
  router.patch("/admin/users/:id", requireAdmin, requirePermission("admin_users.manage"), async (req, res) => {
    const targetId = req.params.id;
    const requestedRole = req.body?.role ? sanitizeText(req.body.role, 40) : void 0;
    const requestedStatus = ["active", "suspended"].includes(req.body?.accountStatus) ? req.body.accountStatus : void 0;
    if (targetId === req.adminUser.id && requestedStatus === "suspended") {
      res.status(400).json({ error: "You cannot suspend your own active administrator session." });
      return;
    }
    const sb = getSupabaseAdminClient();
    if (sb) {
      const { data: target2, error: findErr } = await sb.from("profiles").select("id, email, full_name, phone, avatar_url, account_status, last_login_at, created_at, is_admin, admin_roles(id, name)").eq("id", targetId).eq("is_admin", true).single();
      if (findErr || !target2) {
        res.status(404).json({ error: "Administrator not found." });
        return;
      }
      const currentRoleRel = extractRoleRelation(target2.admin_roles);
      const currentRoleName = currentRoleRel?.name ?? "Admin";
      const roles = await ensureSupabaseSystemRoles(sb);
      const willLeaveSuperAdmin = currentRoleName === "Super Admin" && (requestedRole && requestedRole !== "Super Admin" || requestedStatus === "suspended");
      if (willLeaveSuperAdmin) {
        const superRole = roles.find((r) => r.name === "Super Admin");
        const { count: activeSupers } = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true).eq("account_status", "active").eq("role_id", superRole?.id ?? "");
        if ((activeSupers ?? 0) <= 1) {
          res.status(400).json({ error: "At least one active Super Admin must remain." });
          return;
        }
      }
      const updates = {};
      let nextRoleName = currentRoleName;
      let nextRoleId = currentRoleRel?.id ?? "";
      if (requestedRole) {
        const nextRoleObj = roles.find((r) => r.name === requestedRole);
        if (!nextRoleObj) {
          res.status(400).json({ error: "Invalid administrator role." });
          return;
        }
        updates.role_id = nextRoleObj.id;
        nextRoleName = nextRoleObj.name;
        nextRoleId = nextRoleObj.id;
      }
      if (requestedStatus) {
        updates.account_status = requestedStatus;
      }
      if (req.body?.fullName !== void 0) {
        const cleaned = sanitizeText(req.body.fullName, 120);
        if (cleaned) updates.full_name = cleaned;
      }
      if (req.body?.phone !== void 0) {
        updates.phone = sanitizeText(req.body.phone, 40);
      }
      const { data: updated, error: updErr } = await sb.from("profiles").update(updates).eq("id", targetId).select("id, email, full_name, phone, avatar_url, account_status, last_login_at, created_at").single();
      if (updErr || !updated) {
        res.status(500).json({ error: updErr?.message || "Unable to update administrator." });
        return;
      }
      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "admin_user_updated",
        entityType: "admin_user",
        entityId: targetId,
        summary: `Updated admin ${updated.email} (role: ${nextRoleName}, status: ${updated.account_status}).`
      });
      let permissions = [...ALL_PERMISSION_KEYS];
      if (nextRoleName !== "Super Admin" && nextRoleId) {
        const { data: permRows } = await sb.from("role_permissions").select("permission_key").eq("role_id", nextRoleId).eq("allowed", true);
        permissions = (permRows ?? []).map((p) => p.permission_key);
      }
      res.json({
        item: {
          id: updated.id,
          email: updated.email,
          fullName: updated.full_name,
          phone: updated.phone ?? "",
          avatarUrl: updated.avatar_url ?? "",
          role: nextRoleName,
          accountStatus: updated.account_status,
          permissions,
          lastLoginAt: updated.last_login_at,
          createdAt: updated.created_at
        }
      });
      return;
    }
    const db = getDbState();
    const target = db.admins.find((a) => a.id === targetId);
    if (!target) {
      res.status(404).json({ error: "Administrator not found." });
      return;
    }
    if (requestedRole && db.roles.some((r) => r.role === requestedRole)) {
      if (target.role === "Super Admin" && requestedRole !== "Super Admin") {
        const superCount = db.admins.filter((a) => a.role === "Super Admin" && a.accountStatus === "active").length;
        if (superCount <= 1) {
          res.status(400).json({ error: "At least one active Super Admin must remain." });
          return;
        }
      }
      target.role = requestedRole;
    }
    if (requestedStatus) {
      if (target.role === "Super Admin" && requestedStatus === "suspended") {
        const superCount = db.admins.filter((a) => a.role === "Super Admin" && a.accountStatus === "active").length;
        if (superCount <= 1) {
          res.status(400).json({ error: "At least one active Super Admin must remain active." });
          return;
        }
      }
      target.accountStatus = requestedStatus;
    }
    if (req.body?.fullName !== void 0) target.fullName = sanitizeText(req.body.fullName, 120) || target.fullName;
    if (req.body?.phone !== void 0) target.phone = sanitizeText(req.body.phone, 40);
    target.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    appendActivityLog(db, {
      actorId: req.adminUser.id,
      actorEmail: req.adminUser.email,
      actorRole: req.adminUser.role,
      action: "admin_user_updated",
      entityType: "admin_user",
      entityId: target.id,
      summary: `Updated admin ${target.email} (role: ${target.role}, status: ${target.accountStatus}).`
    });
    saveDbState(db);
    res.json({
      item: {
        id: target.id,
        email: target.email,
        fullName: target.fullName,
        phone: target.phone,
        avatarUrl: target.avatarUrl,
        role: target.role,
        accountStatus: target.accountStatus,
        permissions: getPermissionsForRole(db, target.role),
        lastLoginAt: target.lastLoginAt,
        createdAt: target.createdAt
      }
    });
  });
  router.put("/admin/roles/:roleName", requireAdmin, requirePermission("admin_users.manage"), async (req, res) => {
    const roleName = sanitizeText(req.params.roleName, 40);
    if (roleName === "Super Admin") {
      res.status(400).json({ error: "Super Admin retains all platform permissions." });
      return;
    }
    const requestedPerms = Array.isArray(req.body?.permissions) ? req.body.permissions.filter((p) => ALL_PERMISSION_KEYS.includes(p)) : [];
    const sb = getSupabaseAdminClient();
    if (sb) {
      const roles = await ensureSupabaseSystemRoles(sb);
      const roleRow = roles.find((r) => r.name === roleName);
      if (!roleRow) {
        res.status(404).json({ error: "Role not found." });
        return;
      }
      await sb.from("role_permissions").delete().eq("role_id", roleRow.id);
      if (requestedPerms.length > 0) {
        const { error: insErr } = await sb.from("role_permissions").insert(
          requestedPerms.map((perm) => ({
            role_id: roleRow.id,
            permission_key: perm,
            allowed: true
          }))
        );
        if (insErr) {
          res.status(500).json({ error: `Failed to save role permissions: ${insErr.message}` });
          return;
        }
      }
      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "role_permissions_updated",
        entityType: "admin_role",
        entityId: roleName,
        summary: `Updated permissions for role ${roleName} (${requestedPerms.length} granted).`
      });
      res.json({
        item: {
          role: roleName,
          description: roleRow.description,
          permissions: requestedPerms
        }
      });
      return;
    }
    const db = getDbState();
    const role = db.roles.find((r) => r.role === roleName);
    if (!role) {
      res.status(404).json({ error: "Role not found." });
      return;
    }
    role.permissions = requestedPerms;
    appendActivityLog(db, {
      actorId: req.adminUser.id,
      actorEmail: req.adminUser.email,
      actorRole: req.adminUser.role,
      action: "role_permissions_updated",
      entityType: "admin_role",
      entityId: role.role,
      summary: `Updated permissions for role ${role.role} (${requestedPerms.length} granted).`
    });
    saveDbState(db);
    res.json({ item: role });
  });
  router.patch("/admin/profile", requireAdmin, async (req, res) => {
    const nextName = req.body?.fullName !== void 0 ? sanitizeText(req.body.fullName, 120) : void 0;
    const nextPhone = req.body?.phone !== void 0 ? sanitizeText(req.body.phone, 40) : void 0;
    const sb = getSupabaseAdminClient();
    if (sb) {
      const updates = {};
      if (nextName) updates.full_name = nextName;
      if (nextPhone !== void 0) updates.phone = nextPhone;
      const { error } = await sb.from("profiles").update(updates).eq("id", req.adminUser.id);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.json({
        user: {
          ...req.adminUser,
          fullName: nextName || req.adminUser.fullName,
          phone: nextPhone !== void 0 ? nextPhone : req.adminUser.phone
        }
      });
      return;
    }
    const db = getDbState();
    const admin = db.admins.find((a) => a.id === req.adminUser.id);
    if (!admin) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    if (nextName) admin.fullName = nextName;
    if (nextPhone !== void 0) admin.phone = nextPhone;
    admin.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveDbState(db);
    res.json({
      user: {
        ...req.adminUser,
        fullName: admin.fullName,
        phone: admin.phone
      }
    });
  });
}

// server/routes/cmsAndSystemRoutes.ts
import crypto6 from "node:crypto";
import fs3 from "node:fs";

// server/supabaseRepo.ts
import crypto5 from "node:crypto";
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) {
  return UUID_REGEX.test(value.trim());
}
function asStringArray(val) {
  if (Array.isArray(val)) return val.map((v) => String(v));
  return [];
}
function asNullableNumber(val) {
  if (val === null || val === void 0 || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}
function mapServiceRow(row) {
  return {
    id: String(row.id),
    serviceNumber: String(row.service_number ?? ""),
    slug: String(row.slug ?? ""),
    title: String(row.title ?? ""),
    subtitle: String(row.subtitle ?? ""),
    category: String(row.category ?? ""),
    pricingModel: String(row.pricing_model ?? "Per Work Order / Scope"),
    basePrice: Number(row.base_price ?? 0),
    turnaround: String(row.turnaround ?? ""),
    items: asStringArray(row.items),
    complianceNote: String(row.compliance_note ?? ""),
    imageUrl: String(row.image_url ?? ""),
    isVisible: Boolean(row.is_visible),
    sortOrder: Number(row.sort_order ?? 0),
    isArchived: Boolean(row.is_archived),
    isDemo: Boolean(row.is_demo),
    updatedAt: String(row.updated_at ?? row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapGalleryRow(row) {
  return {
    id: String(row.id),
    slug: String(row.slug ?? ""),
    title: String(row.title ?? ""),
    location: String(row.location ?? ""),
    workOrderId: String(row.work_order_code ?? ""),
    scopeSummary: String(row.scope_summary ?? ""),
    turnaroundHours: Number(row.turnaround_hours ?? 36),
    beforeImage: String(row.before_image_url ?? ""),
    afterImage: String(row.after_image_url ?? ""),
    beforeAlt: String(row.before_alt ?? ""),
    afterAlt: String(row.after_alt ?? ""),
    isPublished: Boolean(row.is_published),
    sortOrder: Number(row.sort_order ?? 0),
    isDemo: Boolean(row.is_demo),
    updatedAt: String(row.updated_at ?? row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapCoverageRow(row) {
  return {
    id: String(row.id),
    region: String(row.region_name ?? ""),
    hubCity: String(row.hub_city ?? ""),
    states: asStringArray(row.states),
    counties: asStringArray(row.counties),
    activeCounties: Number(row.active_counties ?? 0),
    avgDispatchHours: Number(row.avg_dispatch_hours ?? 24),
    hudStandard: String(row.hud_standard ?? ""),
    lat: asNullableNumber(row.lat),
    lng: asNullableNumber(row.lng),
    isHeadquarters: Boolean(row.is_headquarters),
    coverageStatus: row.coverage_status || "Active",
    isPublished: Boolean(row.is_published),
    isDemo: Boolean(row.is_demo),
    updatedAt: String(row.updated_at ?? row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapReviewRow(row) {
  return {
    id: String(row.id),
    reviewer: String(row.reviewer_name ?? ""),
    organization: String(row.organization ?? ""),
    role: String(row.role ?? ""),
    rating: Number(row.rating ?? 5),
    comment: String(row.comment ?? ""),
    serviceTag: String(row.service_tag ?? ""),
    dateLabel: String(row.review_date_label ?? ""),
    isVerifiedCustomer: Boolean(row.is_verified_customer),
    publicationStatus: row.publication_status || "Published",
    sortOrder: Number(row.sort_order ?? 0),
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapSettingsRow(row) {
  if (!row) {
    return {
      businessName: GOOGLE_PROFILE_INFO.businessName,
      phone: "(217) 394-6440",
      email: GOOGLE_PROFILE_INFO.email,
      address: GOOGLE_PROFILE_INFO.address,
      hours: GOOGLE_PROFILE_INFO.hours,
      logoUrl: "",
      defaultWoPriority: "Normal",
      defaultSlaHours: 48,
      autoNotifyUrgent: true,
      coverageRadiusNote: "38 U.S. States \xB7 1,099+ Active Counties",
      googleProfileUrl: GOOGLE_PROFILE_INFO.googleMapsProfileUrl,
      googleRating: GOOGLE_PROFILE_INFO.rating,
      googleReviewCount: GOOGLE_PROFILE_INFO.reviewCount,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  return {
    businessName: String(row.business_name ?? GOOGLE_PROFILE_INFO.businessName),
    phone: String(row.phone ?? "(217) 394-6440"),
    email: String(row.email ?? GOOGLE_PROFILE_INFO.email),
    address: String(row.address ?? GOOGLE_PROFILE_INFO.address),
    hours: String(row.hours ?? GOOGLE_PROFILE_INFO.hours),
    logoUrl: String(row.logo_url ?? ""),
    defaultWoPriority: row.default_wo_priority || "Normal",
    defaultSlaHours: Number(row.default_sla_hours ?? 48),
    autoNotifyUrgent: row.auto_notify_urgent !== false,
    coverageRadiusNote: String(row.coverage_radius_note ?? "38 U.S. States \xB7 1,099+ Active Counties"),
    googleProfileUrl: String(row.google_profile_url ?? GOOGLE_PROFILE_INFO.googleMapsProfileUrl),
    googleRating: Number(row.google_rating ?? 4.9),
    googleReviewCount: Number(row.google_review_count ?? 284),
    updatedAt: String(row.updated_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapClientRow(row) {
  return {
    id: String(row.id),
    clientCode: String(row.client_code ?? ""),
    companyName: String(row.company_name ?? ""),
    contactName: String(row.contact_name ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    clientType: row.client_type || "Property Manager",
    address: String(row.address ?? ""),
    notes: String(row.notes ?? ""),
    accountStatus: row.account_status || "active",
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapClientPropertyRow(row) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    address: String(row.address ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    zipCode: String(row.zip_code ?? ""),
    county: String(row.county ?? ""),
    lat: asNullableNumber(row.lat),
    lng: asNullableNumber(row.lng),
    occupancyStatus: String(row.occupancy_status ?? "Vacant"),
    lockboxCode: String(row.lockbox_code ?? ""),
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapVendorRow(row) {
  return {
    id: String(row.id),
    vendorCode: String(row.vendor_code ?? ""),
    companyName: String(row.company_name ?? ""),
    contactPerson: String(row.contact_person ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    address: String(row.address ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    zipCode: String(row.zip_code ?? ""),
    serviceCategories: asStringArray(row.service_categories),
    coverageAreas: String(row.coverage_areas ?? ""),
    counties: asStringArray(row.counties),
    licenseInfo: String(row.license_info ?? ""),
    insuranceInfo: String(row.insurance_info ?? ""),
    aspenGroveAbc: String(row.aspen_grove_abc ?? ""),
    applicationStatus: row.application_status || "Pending",
    accountStatus: row.account_status || "pending",
    rating: asNullableNumber(row.rating),
    completedWorkOrders: Number(row.completed_work_orders ?? 0),
    notes: String(row.notes ?? ""),
    isDemo: Boolean(row.is_demo),
    registrationDate: String(row.registration_date ?? row.created_at ?? (/* @__PURE__ */ new Date()).toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapVendorDocRow(row) {
  return {
    id: String(row.id),
    vendorId: String(row.vendor_id),
    docType: String(row.doc_type ?? ""),
    fileName: String(row.file_name ?? ""),
    storageBucket: String(row.storage_bucket ?? "vendor-documents"),
    storagePath: String(row.storage_path ?? ""),
    mimeType: String(row.mime_type ?? ""),
    fileSize: Number(row.file_size ?? 0),
    verified: Boolean(row.verified),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapWorkOrderRow(row, vendorNames) {
  const vendorId = row.assigned_vendor_id ? String(row.assigned_vendor_id) : null;
  return {
    id: String(row.id),
    workOrderCode: String(row.work_order_code ?? ""),
    clientId: row.client_id ? String(row.client_id) : null,
    clientName: String(row.client_name ?? ""),
    clientType: row.client_type || "Property Manager",
    propertyAddress: String(row.property_address ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    zipCode: String(row.zip_code ?? ""),
    county: String(row.county ?? ""),
    lat: asNullableNumber(row.lat),
    lng: asNullableNumber(row.lng),
    serviceCategory: String(row.service_category ?? ""),
    serviceDescription: String(row.service_description ?? ""),
    priority: row.priority || "Normal",
    estimatedBudget: Number(row.estimated_budget ?? 0),
    approvedBudget: asNullableNumber(row.approved_budget),
    assignedVendorId: vendorId,
    assignedVendorName: vendorId ? vendorNames.get(vendorId) ?? "" : "",
    createdDate: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString()),
    scheduledDate: row.scheduled_date ? String(row.scheduled_date) : null,
    slaDeadline: row.sla_deadline ? String(row.sla_deadline) : null,
    completionDate: row.completion_date ? String(row.completion_date) : null,
    status: row.status || "New",
    qcNotes: String(row.qc_notes ?? ""),
    isArchived: Boolean(row.is_archived),
    isDemo: Boolean(row.is_demo),
    updatedAt: String(row.updated_at ?? row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapWorkOrderNoteRow(row) {
  return {
    id: String(row.id),
    workOrderId: String(row.work_order_id),
    authorName: String(row.author_name ?? "Admin"),
    isInternal: row.is_internal !== false,
    body: String(row.body ?? ""),
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapWorkOrderAttachmentRow(row, profileNames) {
  const uploaderId = row.uploaded_by ? String(row.uploaded_by) : "";
  return {
    id: String(row.id),
    workOrderId: String(row.work_order_id),
    kind: row.kind || "document",
    fileName: String(row.file_name ?? ""),
    storageBucket: String(row.storage_bucket ?? "work-order-attachments"),
    storagePath: String(row.storage_path ?? ""),
    mimeType: String(row.mime_type ?? ""),
    fileSize: Number(row.file_size ?? 0),
    uploadedBy: uploaderId && profileNames.get(uploaderId) || "Admin",
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapWorkOrderTimelineRow(row) {
  return {
    id: String(row.id),
    workOrderId: String(row.work_order_id),
    actorName: String(row.actor_name ?? "System"),
    eventType: String(row.event_type ?? "update"),
    description: String(row.description ?? ""),
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapBidRequestRow(row) {
  return {
    id: String(row.id),
    requestCode: String(row.request_code ?? ""),
    contactName: String(row.contact_name ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    propertyAddress: String(row.property_address ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    zipCode: String(row.zip_code ?? ""),
    requestedServices: String(row.requested_services ?? ""),
    notes: String(row.notes ?? ""),
    estimatorData: row.estimator_data ?? null,
    status: row.status || "New",
    internalNotes: String(row.internal_notes ?? ""),
    convertedWorkOrderId: row.converted_work_order_id ? String(row.converted_work_order_id) : null,
    isArchived: Boolean(row.is_archived),
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapVendorBidRow(row, woCodeMap) {
  const woId = String(row.work_order_id ?? "");
  return {
    id: String(row.id),
    bidCode: String(row.bid_code ?? ""),
    workOrderId: woId,
    workOrderCode: woCodeMap.get(woId) ?? "",
    vendorId: row.vendor_id ? String(row.vendor_id) : null,
    vendorName: String(row.vendor_name ?? ""),
    aspenGroveAbc: String(row.aspen_grove_abc ?? ""),
    proposedPrice: Number(row.proposed_price ?? 0),
    estimatedCompletionTime: String(row.estimated_completion_time ?? "48 Hours"),
    bidNotes: String(row.bid_notes ?? ""),
    attachments: asStringArray(row.attachments),
    status: row.status || "Submitted",
    clarificationNote: String(row.clarification_note ?? ""),
    submittedDate: String(row.submitted_at ?? (/* @__PURE__ */ new Date()).toISOString()),
    updatedAt: String(row.updated_at ?? row.submitted_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapDispatchRow(row, vendorNames) {
  const vendorId = row.assigned_vendor_id ? String(row.assigned_vendor_id) : null;
  const rawTimeline = Array.isArray(row.timeline) ? row.timeline : [];
  return {
    id: String(row.id),
    dispatchCode: String(row.dispatch_code ?? ""),
    contactName: String(row.contact_name ?? ""),
    phone: String(row.phone ?? ""),
    email: String(row.email ?? ""),
    propertyAddress: String(row.property_address ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    zipCode: String(row.zip_code ?? ""),
    emergencyType: String(row.emergency_type ?? ""),
    description: String(row.description ?? ""),
    priority: row.priority || "Urgent",
    status: row.status || "New",
    assignedVendorId: vendorId,
    assignedVendorName: vendorId ? vendorNames.get(vendorId) ?? "" : "",
    internalNotes: String(row.internal_notes ?? ""),
    timeline: rawTimeline.map((t) => ({
      id: String(t.id ?? crypto5.randomUUID()),
      actorName: String(t.actorName ?? "System"),
      description: String(t.description ?? ""),
      createdAt: String(t.createdAt ?? (/* @__PURE__ */ new Date()).toISOString())
    })),
    submittedDate: String(row.submitted_at ?? (/* @__PURE__ */ new Date()).toISOString()),
    updatedAt: String(row.updated_at ?? row.submitted_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapMessageRow(row) {
  return {
    id: String(row.id),
    senderName: String(row.sender_name ?? ""),
    senderEmail: String(row.sender_email ?? ""),
    senderPhone: String(row.sender_phone ?? ""),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    source: String(row.source ?? "Contact Form"),
    status: row.status || "Unread",
    internalNotes: String(row.internal_notes ?? ""),
    linkedClientId: row.linked_client_id ? String(row.linked_client_id) : null,
    linkedBidRequestId: row.linked_bid_request_id ? String(row.linked_bid_request_id) : null,
    linkedWorkOrderId: row.linked_work_order_id ? String(row.linked_work_order_id) : null,
    linkedDispatchId: row.linked_dispatch_id ? String(row.linked_dispatch_id) : null,
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapNotificationRow(row) {
  return {
    id: String(row.id),
    eventType: String(row.event_type ?? ""),
    title: String(row.title ?? ""),
    message: String(row.message ?? ""),
    entityType: String(row.entity_type ?? ""),
    entityId: String(row.entity_id ?? ""),
    isRead: Boolean(row.is_read),
    recipientRole: String(row.recipient_role ?? "All Admins"),
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
function mapActivityLogRow(row) {
  return {
    id: String(row.id),
    actorId: row.actor_id ? String(row.actor_id) : null,
    actorEmail: String(row.actor_email ?? ""),
    actorRole: String(row.actor_role ?? ""),
    action: String(row.action ?? ""),
    entityType: String(row.entity_type ?? ""),
    entityId: String(row.entity_id ?? ""),
    summary: String(row.summary ?? ""),
    createdAt: String(row.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
  };
}
async function getVendorNameMap(sb) {
  const { data } = await sb.from("vendors").select("id, company_name");
  const map = /* @__PURE__ */ new Map();
  for (const v of data ?? []) {
    map.set(String(v.id), String(v.company_name ?? ""));
  }
  return map;
}
async function getWorkOrderCodeMap(sb) {
  const { data } = await sb.from("work_orders").select("id, work_order_code");
  const map = /* @__PURE__ */ new Map();
  for (const w of data ?? []) {
    map.set(String(w.id), String(w.work_order_code ?? ""));
  }
  return map;
}
async function getProfileNameMap(sb) {
  const { data } = await sb.from("profiles").select("id, full_name");
  const map = /* @__PURE__ */ new Map();
  for (const p of data ?? []) {
    map.set(String(p.id), String(p.full_name ?? "Admin"));
  }
  return map;
}
async function insertSupabaseNotification(sb, notif) {
  await sb.from("notifications").insert({
    event_type: notif.eventType,
    title: notif.title,
    message: notif.message,
    entity_type: notif.entityType,
    entity_id: notif.entityId,
    is_read: false,
    recipient_role: notif.recipientRole || "All Admins"
  });
}
async function insertSupabaseWorkOrderTimeline(sb, workOrderId, actorName, eventType, description) {
  await sb.from("work_order_timeline").insert({
    work_order_id: workOrderId,
    actor_name: actorName,
    event_type: eventType,
    description
  });
}
async function getSupabaseBusinessSettings(sb) {
  const { data } = await sb.from("business_settings").select("*").eq("id", 1).maybeSingle();
  return mapSettingsRow(data);
}
async function getPublicBootstrapFromSupabase(sb) {
  const [svcRes, galRes, covRes, revRes, woRes, settingsRow] = await Promise.all([
    sb.from("services").select("*").eq("is_visible", true).eq("is_archived", false).order("sort_order", { ascending: true }),
    sb.from("gallery_cases").select("*").eq("is_published", true).order("sort_order", { ascending: true }),
    sb.from("coverage_regions").select("*").eq("is_published", true).order("is_headquarters", { ascending: false }),
    sb.from("reviews").select("*").eq("publication_status", "Published").order("sort_order", { ascending: true }),
    sb.from("work_orders").select("*").eq("is_archived", false).in("status", ["Open Bid", "Dispatched", "In Progress", "QC Verified"]).order("created_at", { ascending: false }),
    sb.from("business_settings").select("*").eq("id", 1).maybeSingle()
  ]);
  const err = svcRes.error || galRes.error || covRes.error || revRes.error || woRes.error || settingsRow.error;
  if (err) {
    throw new Error(`Supabase query error: ${err.message}`);
  }
  return {
    services: (svcRes.data ?? []).map((r) => mapServiceRow(r)),
    galleryCases: (galRes.data ?? []).map((r) => mapGalleryRow(r)),
    coverageRegions: (covRes.data ?? []).map((r) => mapCoverageRow(r)),
    reviews: (revRes.data ?? []).map((r) => mapReviewRow(r)),
    publicWorkOrders: (woRes.data ?? []).map((w) => {
      const slaDeadline = w.sla_deadline ? String(w.sla_deadline) : null;
      return {
        id: String(w.id),
        workOrderCode: String(w.work_order_code ?? ""),
        clientType: w.client_type || "Property Manager",
        serviceType: String(w.service_description ?? ""),
        cityState: `${String(w.city ?? "")}, ${String(w.state ?? "")}`,
        county: String(w.county ?? ""),
        status: w.status || "Open Bid",
        slaDue: slaDeadline ? `SLA: ${new Date(slaDeadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Standard SLA",
        estimatedBudget: Number(w.estimated_budget ?? 0),
        coordinates: w.lat != null && w.lng != null ? { lat: Number(w.lat), lng: Number(w.lng) } : null
      };
    }),
    businessSettings: mapSettingsRow(settingsRow.data)
  };
}
var DEFAULT_NOTIFICATION_EVENTS = {
  new_bid_request: true,
  new_vendor_application: true,
  new_vendor_bid: true,
  new_dispatch_request: true,
  new_work_order: true,
  qc_rejected: true,
  work_order_completed: true
};
async function getSupabaseNotificationPrefs(sb, profileId) {
  const { data } = await sb.from("notification_preferences").select("email_enabled, events_config").eq("profile_id", profileId).maybeSingle();
  if (!data) {
    return {
      emailEnabled: false,
      events: { ...DEFAULT_NOTIFICATION_EVENTS }
    };
  }
  return {
    emailEnabled: Boolean(data.email_enabled),
    events: data.events_config && typeof data.events_config === "object" ? data.events_config : { ...DEFAULT_NOTIFICATION_EVENTS }
  };
}

// server/routes/cmsAndSystemRoutes.ts
function registerCmsAndSystemRoutes(router) {
  router.get("/admin/services", requireAdmin, requirePermission("services.manage"), async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb.from("services").select("*").order("sort_order", { ascending: true });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapServiceRow(r)) });
        return;
      }
      const db = getDbState();
      res.json({ items: [...db.services].sort((a, b) => a.sortOrder - b.sortOrder) });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/services", requireAdmin, requirePermission("services.manage"), async (req, res, next) => {
    try {
      const title = sanitizeText(req.body?.title, 140);
      const subtitle = sanitizeText(req.body?.subtitle, 500);
      if (!title || !subtitle) {
        res.status(400).json({ error: "Service title and description are required." });
        return;
      }
      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString().slice(-4)}`;
      const itemsList = Array.isArray(req.body?.items) ? req.body.items.map((i) => sanitizeText(i, 200)).filter(Boolean) : [];
      const rawImageUrl = sanitizeText(req.body?.imageUrl, 500);
      const safeImageUrl = isSafeMediaUrl(rawImageUrl) ? rawImageUrl : "";
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { count } = await sb.from("services").select("id", { count: "exact", head: true });
        const sortOrder = (count ?? 0) + 1;
        const nextNum2 = `${String(sortOrder).padStart(2, "0")}.`;
        const { data: inserted, error: insErr } = await sb.from("services").insert({
          service_number: sanitizeText(req.body?.serviceNumber, 12) || nextNum2,
          slug,
          title,
          subtitle,
          category: sanitizeText(req.body?.category, 140) || title,
          pricing_model: sanitizeText(req.body?.pricingModel, 80) || "Per Work Order",
          base_price: Number(req.body?.basePrice) || 0,
          turnaround: sanitizeText(req.body?.turnaround, 80) || "48 hr SLA",
          items: itemsList,
          compliance_note: sanitizeText(req.body?.complianceNote, 240),
          image_url: safeImageUrl,
          is_visible: req.body?.isVisible !== false,
          sort_order: sortOrder,
          is_archived: false,
          is_demo: false
        }).select("*").single();
        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || "Unable to create service." });
          return;
        }
        const service2 = mapServiceRow(inserted);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "service_created",
          entityType: "service",
          entityId: service2.id,
          summary: `Created service "${service2.title}".`
        });
        res.status(201).json({ item: service2 });
        return;
      }
      const db = getDbState();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const nextNum = `${String(db.services.length + 1).padStart(2, "0")}.`;
      const service = {
        id: crypto6.randomUUID(),
        serviceNumber: sanitizeText(req.body?.serviceNumber, 12) || nextNum,
        slug,
        title,
        subtitle,
        category: sanitizeText(req.body?.category, 140) || title,
        pricingModel: sanitizeText(req.body?.pricingModel, 80) || "Per Work Order",
        basePrice: Number(req.body?.basePrice) || 0,
        turnaround: sanitizeText(req.body?.turnaround, 80) || "48 hr SLA",
        items: itemsList,
        complianceNote: sanitizeText(req.body?.complianceNote, 240),
        imageUrl: safeImageUrl,
        isVisible: req.body?.isVisible !== false,
        sortOrder: db.services.length + 1,
        isArchived: false,
        isDemo: false,
        updatedAt: now
      };
      db.services.push(service);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "service_created",
        entityType: "service",
        entityId: service.id,
        summary: `Created service "${service.title}".`
      });
      saveDbState(db);
      res.status(201).json({ item: service });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/services/:id", requireAdmin, requirePermission("services.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Service not found." });
          return;
        }
        const updates = {};
        if (req.body?.serviceNumber !== void 0) updates.service_number = sanitizeText(req.body.serviceNumber, 12);
        if (req.body?.title !== void 0) updates.title = sanitizeText(req.body.title, 140);
        if (req.body?.subtitle !== void 0) updates.subtitle = sanitizeText(req.body.subtitle, 500);
        if (req.body?.category !== void 0) updates.category = sanitizeText(req.body.category, 140);
        if (req.body?.pricingModel !== void 0) updates.pricing_model = sanitizeText(req.body.pricingModel, 80);
        if (req.body?.basePrice !== void 0) updates.base_price = Number(req.body.basePrice) || 0;
        if (req.body?.turnaround !== void 0) updates.turnaround = sanitizeText(req.body.turnaround, 80);
        if (Array.isArray(req.body?.items)) updates.items = req.body.items.map((i) => sanitizeText(i, 200)).filter(Boolean);
        if (req.body?.complianceNote !== void 0) updates.compliance_note = sanitizeText(req.body.complianceNote, 240);
        if (req.body?.imageUrl !== void 0) {
          const url = sanitizeText(req.body.imageUrl, 500);
          if (isSafeMediaUrl(url)) updates.image_url = url;
        }
        if (req.body?.isVisible !== void 0) updates.is_visible = Boolean(req.body.isVisible);
        if (req.body?.isArchived !== void 0) updates.is_archived = Boolean(req.body.isArchived);
        if (req.body?.sortOrder !== void 0) updates.sort_order = Number(req.body.sortOrder) || 0;
        const { data: updated, error: updErr } = await sb.from("services").update(updates).eq("id", req.params.id).select("*").maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Service not found." });
          return;
        }
        const svc2 = mapServiceRow(updated);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "service_updated",
          entityType: "service",
          entityId: svc2.id,
          summary: `Updated service "${svc2.title}".`
        });
        res.json({ item: svc2 });
        return;
      }
      const db = getDbState();
      const svc = db.services.find((s) => s.id === req.params.id);
      if (!svc) {
        res.status(404).json({ error: "Service not found." });
        return;
      }
      if (req.body?.serviceNumber !== void 0) svc.serviceNumber = sanitizeText(req.body.serviceNumber, 12);
      if (req.body?.title !== void 0) svc.title = sanitizeText(req.body.title, 140);
      if (req.body?.subtitle !== void 0) svc.subtitle = sanitizeText(req.body.subtitle, 500);
      if (req.body?.category !== void 0) svc.category = sanitizeText(req.body.category, 140);
      if (req.body?.pricingModel !== void 0) svc.pricingModel = sanitizeText(req.body.pricingModel, 80);
      if (req.body?.basePrice !== void 0) svc.basePrice = Number(req.body.basePrice) || 0;
      if (req.body?.turnaround !== void 0) svc.turnaround = sanitizeText(req.body.turnaround, 80);
      if (Array.isArray(req.body?.items)) svc.items = req.body.items.map((i) => sanitizeText(i, 200)).filter(Boolean);
      if (req.body?.complianceNote !== void 0) svc.complianceNote = sanitizeText(req.body.complianceNote, 240);
      if (req.body?.imageUrl !== void 0) {
        const url = sanitizeText(req.body.imageUrl, 500);
        if (isSafeMediaUrl(url)) svc.imageUrl = url;
      }
      if (req.body?.isVisible !== void 0) svc.isVisible = Boolean(req.body.isVisible);
      if (req.body?.isArchived !== void 0) svc.isArchived = Boolean(req.body.isArchived);
      if (req.body?.sortOrder !== void 0) svc.sortOrder = Number(req.body.sortOrder) || svc.sortOrder;
      svc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "service_updated",
        entityType: "service",
        entityId: svc.id,
        summary: `Updated service "${svc.title}".`
      });
      saveDbState(db);
      res.json({ item: svc });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/admin/services/:id", requireAdmin, requirePermission("services.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Service not found." });
          return;
        }
        const { data: existing } = await sb.from("services").select("id, title").eq("id", req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: "Service not found." });
          return;
        }
        const { error: delErr } = await sb.from("services").delete().eq("id", req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "service_deleted",
          entityType: "service",
          entityId: existing.id,
          summary: `Removed service "${existing.title}".`
        });
        res.json({ ok: true });
        return;
      }
      const db = getDbState();
      const idx = db.services.findIndex((s) => s.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: "Service not found." });
        return;
      }
      const [removed] = db.services.splice(idx, 1);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "service_deleted",
        entityType: "service",
        entityId: removed.id,
        summary: `Removed service "${removed.title}".`
      });
      saveDbState(db);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/gallery", requireAdmin, requirePermission("gallery.manage"), async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb.from("gallery_cases").select("*").order("sort_order", { ascending: true });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapGalleryRow(r)) });
        return;
      }
      const db = getDbState();
      res.json({ items: [...db.galleryCases].sort((a, b) => a.sortOrder - b.sortOrder) });
    } catch (err) {
      next(err);
    }
  });
  router.post(
    "/admin/gallery/upload",
    requireAdmin,
    requirePermission("gallery.manage"),
    uploadImageMiddleware.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "Image file is required." });
          return;
        }
        const { publicUrl, storagePath } = await persistUploadedFile("gallery", req.file);
        res.status(201).json({ url: publicUrl || `/uploads/gallery/${storagePath}` });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Image upload failed." });
      }
    }
  );
  router.post("/admin/gallery", requireAdmin, requirePermission("gallery.manage"), async (req, res, next) => {
    try {
      const title = sanitizeText(req.body?.title, 160);
      const location = sanitizeText(req.body?.location, 120);
      const beforeImage = sanitizeText(req.body?.beforeImage, 500);
      const afterImage = sanitizeText(req.body?.afterImage, 500);
      if (!title || !location || !beforeImage || !afterImage || !isSafeMediaUrl(beforeImage) || !isSafeMediaUrl(afterImage)) {
        res.status(400).json({ error: "Title, location, and valid before/after image URLs are required." });
        return;
      }
      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString().slice(-4)}`;
      const workOrderId = sanitizeText(req.body?.workOrderId, 60) || `WO-${Math.floor(88e3 + Math.random() * 9999)}`;
      const scopeSummary = sanitizeText(req.body?.scopeSummary, 600);
      const turnaroundHours = Math.max(1, Number(req.body?.turnaroundHours) || 36);
      const beforeAlt = sanitizeText(req.body?.beforeAlt, 240) || `Before photo for ${title}`;
      const afterAlt = sanitizeText(req.body?.afterAlt, 240) || `After photo for ${title}`;
      const isPublished = req.body?.isPublished !== false;
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { count } = await sb.from("gallery_cases").select("id", { count: "exact", head: true });
        const { data: inserted, error: insErr } = await sb.from("gallery_cases").insert({
          slug,
          title,
          location,
          work_order_code: workOrderId,
          scope_summary: scopeSummary,
          turnaround_hours: turnaroundHours,
          before_image_url: beforeImage,
          after_image_url: afterImage,
          before_alt: beforeAlt,
          after_alt: afterAlt,
          is_published: isPublished,
          sort_order: (count ?? 0) + 1,
          is_demo: false
        }).select("*").single();
        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || "Unable to create gallery case." });
          return;
        }
        const item2 = mapGalleryRow(inserted);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "gallery_case_created",
          entityType: "gallery",
          entityId: item2.id,
          summary: `Added gallery case "${item2.title}".`
        });
        res.status(201).json({ item: item2 });
        return;
      }
      const db = getDbState();
      const item = {
        id: crypto6.randomUUID(),
        slug,
        title,
        location,
        workOrderId,
        scopeSummary,
        turnaroundHours,
        beforeImage,
        afterImage,
        beforeAlt,
        afterAlt,
        isPublished,
        sortOrder: db.galleryCases.length + 1,
        isDemo: false,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      db.galleryCases.push(item);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "gallery_case_created",
        entityType: "gallery",
        entityId: item.id,
        summary: `Added gallery case "${item.title}".`
      });
      saveDbState(db);
      res.status(201).json({ item });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/gallery/:id", requireAdmin, requirePermission("gallery.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Gallery case not found." });
          return;
        }
        const updates = {};
        if (req.body?.title !== void 0) updates.title = sanitizeText(req.body.title, 160);
        if (req.body?.location !== void 0) updates.location = sanitizeText(req.body.location, 120);
        if (req.body?.workOrderId !== void 0) updates.work_order_code = sanitizeText(req.body.workOrderId, 60);
        if (req.body?.scopeSummary !== void 0) updates.scope_summary = sanitizeText(req.body.scopeSummary, 600);
        if (req.body?.turnaroundHours !== void 0) updates.turnaround_hours = Math.max(1, Number(req.body.turnaroundHours) || 36);
        if (req.body?.beforeImage && isSafeMediaUrl(req.body.beforeImage)) updates.before_image_url = sanitizeText(req.body.beforeImage, 500);
        if (req.body?.afterImage && isSafeMediaUrl(req.body.afterImage)) updates.after_image_url = sanitizeText(req.body.afterImage, 500);
        if (req.body?.beforeAlt !== void 0) updates.before_alt = sanitizeText(req.body.beforeAlt, 240);
        if (req.body?.afterAlt !== void 0) updates.after_alt = sanitizeText(req.body.afterAlt, 240);
        if (req.body?.isPublished !== void 0) updates.is_published = Boolean(req.body.isPublished);
        if (req.body?.sortOrder !== void 0) updates.sort_order = Number(req.body.sortOrder) || 0;
        const { data: updated, error: updErr } = await sb.from("gallery_cases").update(updates).eq("id", req.params.id).select("*").maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Gallery case not found." });
          return;
        }
        const item2 = mapGalleryRow(updated);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "gallery_case_updated",
          entityType: "gallery",
          entityId: item2.id,
          summary: `Updated gallery case "${item2.title}" (published: ${item2.isPublished}).`
        });
        res.json({ item: item2 });
        return;
      }
      const db = getDbState();
      const item = db.galleryCases.find((g) => g.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: "Gallery case not found." });
        return;
      }
      if (req.body?.title !== void 0) item.title = sanitizeText(req.body.title, 160);
      if (req.body?.location !== void 0) item.location = sanitizeText(req.body.location, 120);
      if (req.body?.workOrderId !== void 0) item.workOrderId = sanitizeText(req.body.workOrderId, 60);
      if (req.body?.scopeSummary !== void 0) item.scopeSummary = sanitizeText(req.body.scopeSummary, 600);
      if (req.body?.turnaroundHours !== void 0) item.turnaroundHours = Math.max(1, Number(req.body.turnaroundHours) || item.turnaroundHours);
      if (req.body?.beforeImage && isSafeMediaUrl(req.body.beforeImage)) item.beforeImage = sanitizeText(req.body.beforeImage, 500);
      if (req.body?.afterImage && isSafeMediaUrl(req.body.afterImage)) item.afterImage = sanitizeText(req.body.afterImage, 500);
      if (req.body?.beforeAlt !== void 0) item.beforeAlt = sanitizeText(req.body.beforeAlt, 240);
      if (req.body?.afterAlt !== void 0) item.afterAlt = sanitizeText(req.body.afterAlt, 240);
      if (req.body?.isPublished !== void 0) item.isPublished = Boolean(req.body.isPublished);
      if (req.body?.sortOrder !== void 0) item.sortOrder = Number(req.body.sortOrder) || item.sortOrder;
      item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "gallery_case_updated",
        entityType: "gallery",
        entityId: item.id,
        summary: `Updated gallery case "${item.title}" (published: ${item.isPublished}).`
      });
      saveDbState(db);
      res.json({ item });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/admin/gallery/:id", requireAdmin, requirePermission("gallery.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Gallery case not found." });
          return;
        }
        const { data: existing } = await sb.from("gallery_cases").select("id, title").eq("id", req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: "Gallery case not found." });
          return;
        }
        const { error: delErr } = await sb.from("gallery_cases").delete().eq("id", req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "gallery_case_deleted",
          entityType: "gallery",
          entityId: existing.id,
          summary: `Deleted gallery case "${existing.title}".`
        });
        res.json({ ok: true });
        return;
      }
      const db = getDbState();
      const idx = db.galleryCases.findIndex((g) => g.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: "Gallery case not found." });
        return;
      }
      const [removed] = db.galleryCases.splice(idx, 1);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "gallery_case_deleted",
        entityType: "gallery",
        entityId: removed.id,
        summary: `Deleted gallery case "${removed.title}".`
      });
      saveDbState(db);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/coverage", requireAdmin, requirePermission("coverage.manage"), async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb.from("coverage_regions").select("*").order("is_headquarters", { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapCoverageRow(r)) });
        return;
      }
      res.json({ items: getDbState().coverageRegions });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/coverage", requireAdmin, requirePermission("coverage.manage"), async (req, res, next) => {
    try {
      const region = sanitizeText(req.body?.region, 140);
      const hubCity = sanitizeText(req.body?.hubCity, 120);
      if (!region || !hubCity) {
        res.status(400).json({ error: "Region name and hub city are required." });
        return;
      }
      const states = Array.isArray(req.body?.states) ? req.body.states.map((s) => sanitizeText(s, 10)).filter(Boolean) : [];
      const counties = Array.isArray(req.body?.counties) ? req.body.counties.map((c) => sanitizeText(c, 80)).filter(Boolean) : [];
      const activeCounties = Math.max(0, Number(req.body?.activeCounties) || 0);
      const avgDispatchHours = Math.max(1, Number(req.body?.avgDispatchHours) || 24);
      const hudStandard = sanitizeText(req.body?.hudStandard, 240);
      const lat = req.body?.lat !== void 0 && req.body?.lat !== "" ? Number(req.body.lat) : null;
      const lng = req.body?.lng !== void 0 && req.body?.lng !== "" ? Number(req.body.lng) : null;
      const isHeadquarters = Boolean(req.body?.isHeadquarters);
      const coverageStatus = ["Active", "Expanding", "Paused"].includes(req.body?.coverageStatus) ? req.body.coverageStatus : "Active";
      const isPublished = req.body?.isPublished !== false;
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error: insErr } = await sb.from("coverage_regions").insert({
          region_name: region,
          hub_city: hubCity,
          states,
          counties,
          active_counties: activeCounties,
          avg_dispatch_hours: avgDispatchHours,
          hud_standard: hudStandard,
          lat,
          lng,
          is_headquarters: isHeadquarters,
          coverage_status: coverageStatus,
          is_published: isPublished,
          is_demo: false
        }).select("*").single();
        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || "Unable to create coverage region." });
          return;
        }
        const item2 = mapCoverageRow(inserted);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "coverage_region_created",
          entityType: "coverage",
          entityId: item2.id,
          summary: `Added coverage region "${item2.region}".`
        });
        res.status(201).json({ item: item2 });
        return;
      }
      const db = getDbState();
      const item = {
        id: crypto6.randomUUID(),
        region,
        hubCity,
        states,
        counties,
        activeCounties,
        avgDispatchHours,
        hudStandard,
        lat,
        lng,
        isHeadquarters,
        coverageStatus,
        isPublished,
        isDemo: false,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      db.coverageRegions.push(item);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "coverage_region_created",
        entityType: "coverage",
        entityId: item.id,
        summary: `Added coverage region "${item.region}".`
      });
      saveDbState(db);
      res.status(201).json({ item });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/coverage/:id", requireAdmin, requirePermission("coverage.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Coverage region not found." });
          return;
        }
        const updates = {};
        if (req.body?.region !== void 0) updates.region_name = sanitizeText(req.body.region, 140);
        if (req.body?.hubCity !== void 0) updates.hub_city = sanitizeText(req.body.hubCity, 120);
        if (Array.isArray(req.body?.states)) updates.states = req.body.states.map((s) => sanitizeText(s, 10)).filter(Boolean);
        if (Array.isArray(req.body?.counties)) updates.counties = req.body.counties.map((c) => sanitizeText(c, 80)).filter(Boolean);
        if (req.body?.activeCounties !== void 0) updates.active_counties = Math.max(0, Number(req.body.activeCounties) || 0);
        if (req.body?.avgDispatchHours !== void 0) updates.avg_dispatch_hours = Math.max(1, Number(req.body.avgDispatchHours) || 24);
        if (req.body?.hudStandard !== void 0) updates.hud_standard = sanitizeText(req.body.hudStandard, 240);
        if (req.body?.lat !== void 0) updates.lat = req.body.lat === null || req.body.lat === "" ? null : Number(req.body.lat);
        if (req.body?.lng !== void 0) updates.lng = req.body.lng === null || req.body.lng === "" ? null : Number(req.body.lng);
        if (req.body?.isHeadquarters !== void 0) updates.is_headquarters = Boolean(req.body.isHeadquarters);
        if (["Active", "Expanding", "Paused"].includes(req.body?.coverageStatus)) updates.coverage_status = req.body.coverageStatus;
        if (req.body?.isPublished !== void 0) updates.is_published = Boolean(req.body.isPublished);
        const { data: updated, error: updErr } = await sb.from("coverage_regions").update(updates).eq("id", req.params.id).select("*").maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Coverage region not found." });
          return;
        }
        const item2 = mapCoverageRow(updated);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "coverage_region_updated",
          entityType: "coverage",
          entityId: item2.id,
          summary: `Updated coverage region "${item2.region}".`
        });
        res.json({ item: item2 });
        return;
      }
      const db = getDbState();
      const item = db.coverageRegions.find((r) => r.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: "Coverage region not found." });
        return;
      }
      if (req.body?.region !== void 0) item.region = sanitizeText(req.body.region, 140);
      if (req.body?.hubCity !== void 0) item.hubCity = sanitizeText(req.body.hubCity, 120);
      if (Array.isArray(req.body?.states)) item.states = req.body.states.map((s) => sanitizeText(s, 10)).filter(Boolean);
      if (Array.isArray(req.body?.counties)) item.counties = req.body.counties.map((c) => sanitizeText(c, 80)).filter(Boolean);
      if (req.body?.activeCounties !== void 0) item.activeCounties = Math.max(0, Number(req.body.activeCounties) || 0);
      if (req.body?.avgDispatchHours !== void 0) item.avgDispatchHours = Math.max(1, Number(req.body.avgDispatchHours) || 24);
      if (req.body?.hudStandard !== void 0) item.hudStandard = sanitizeText(req.body.hudStandard, 240);
      if (req.body?.lat !== void 0) item.lat = req.body.lat === null || req.body.lat === "" ? null : Number(req.body.lat);
      if (req.body?.lng !== void 0) item.lng = req.body.lng === null || req.body.lng === "" ? null : Number(req.body.lng);
      if (req.body?.isHeadquarters !== void 0) item.isHeadquarters = Boolean(req.body.isHeadquarters);
      if (["Active", "Expanding", "Paused"].includes(req.body?.coverageStatus)) item.coverageStatus = req.body.coverageStatus;
      if (req.body?.isPublished !== void 0) item.isPublished = Boolean(req.body.isPublished);
      item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "coverage_region_updated",
        entityType: "coverage",
        entityId: item.id,
        summary: `Updated coverage region "${item.region}".`
      });
      saveDbState(db);
      res.json({ item });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/admin/coverage/:id", requireAdmin, requirePermission("coverage.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Coverage region not found." });
          return;
        }
        const { data: existing } = await sb.from("coverage_regions").select("id, region_name").eq("id", req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: "Coverage region not found." });
          return;
        }
        const { error: delErr } = await sb.from("coverage_regions").delete().eq("id", req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "coverage_region_deleted",
          entityType: "coverage",
          entityId: existing.id,
          summary: `Removed coverage region "${existing.region_name}".`
        });
        res.json({ ok: true });
        return;
      }
      const db = getDbState();
      const idx = db.coverageRegions.findIndex((r) => r.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: "Coverage region not found." });
        return;
      }
      const [removed] = db.coverageRegions.splice(idx, 1);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "coverage_region_deleted",
        entityType: "coverage",
        entityId: removed.id,
        summary: `Removed coverage region "${removed.region}".`
      });
      saveDbState(db);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/reviews", requireAdmin, requirePermission("reviews.manage"), async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb.from("reviews").select("*").order("sort_order", { ascending: true });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapReviewRow(r)) });
        return;
      }
      const items = [...getDbState().reviews].sort((a, b) => a.sortOrder - b.sortOrder);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/reviews", requireAdmin, requirePermission("reviews.manage"), async (req, res, next) => {
    try {
      const reviewer = sanitizeText(req.body?.reviewer, 120);
      const comment = sanitizeText(req.body?.comment, 2e3);
      if (!reviewer || !comment) {
        res.status(400).json({ error: "Reviewer name and comment are required." });
        return;
      }
      const statusRaw = sanitizeText(req.body?.publicationStatus, 30);
      const publicationStatus = ["Pending", "Approved", "Published", "Hidden"].includes(statusRaw) ? statusRaw : "Published";
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { count } = await sb.from("reviews").select("id", { count: "exact", head: true });
        const { data: inserted, error: insErr } = await sb.from("reviews").insert({
          reviewer_name: reviewer,
          organization: sanitizeText(req.body?.organization, 140),
          role: sanitizeText(req.body?.role, 120),
          rating: Math.min(5, Math.max(1, Number(req.body?.rating) || 5)),
          comment,
          service_tag: sanitizeText(req.body?.serviceTag, 140),
          review_date_label: sanitizeText(req.body?.dateLabel, 60) || "Recently",
          is_verified_customer: false,
          publication_status: publicationStatus,
          sort_order: (count ?? 0) + 1,
          is_demo: false
        }).select("*").single();
        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || "Unable to create review." });
          return;
        }
        const item2 = mapReviewRow(inserted);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "review_created",
          entityType: "review",
          entityId: item2.id,
          summary: `Added manual review entry for ${item2.reviewer}.`
        });
        res.status(201).json({ item: item2 });
        return;
      }
      const db = getDbState();
      const item = {
        id: crypto6.randomUUID(),
        reviewer,
        organization: sanitizeText(req.body?.organization, 140),
        role: sanitizeText(req.body?.role, 120),
        rating: Math.min(5, Math.max(1, Number(req.body?.rating) || 5)),
        comment,
        serviceTag: sanitizeText(req.body?.serviceTag, 140),
        dateLabel: sanitizeText(req.body?.dateLabel, 60) || "Recently",
        isVerifiedCustomer: false,
        publicationStatus,
        sortOrder: db.reviews.length + 1,
        isDemo: false,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      db.reviews.push(item);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "review_created",
        entityType: "review",
        entityId: item.id,
        summary: `Added manual review entry for ${item.reviewer}.`
      });
      saveDbState(db);
      res.status(201).json({ item });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/reviews/:id", requireAdmin, requirePermission("reviews.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Review not found." });
          return;
        }
        const updates = {};
        if (req.body?.reviewer !== void 0) updates.reviewer_name = sanitizeText(req.body.reviewer, 120);
        if (req.body?.organization !== void 0) updates.organization = sanitizeText(req.body.organization, 140);
        if (req.body?.role !== void 0) updates.role = sanitizeText(req.body.role, 120);
        if (req.body?.rating !== void 0) updates.rating = Math.min(5, Math.max(1, Number(req.body.rating) || 5));
        if (req.body?.comment !== void 0) updates.comment = sanitizeText(req.body.comment, 2e3);
        if (req.body?.serviceTag !== void 0) updates.service_tag = sanitizeText(req.body.serviceTag, 140);
        if (req.body?.dateLabel !== void 0) updates.review_date_label = sanitizeText(req.body.dateLabel, 60);
        if (["Pending", "Approved", "Published", "Hidden"].includes(req.body?.publicationStatus)) {
          updates.publication_status = req.body.publicationStatus;
        }
        if (req.body?.sortOrder !== void 0) updates.sort_order = Number(req.body.sortOrder) || 0;
        const { data: updated, error: updErr } = await sb.from("reviews").update(updates).eq("id", req.params.id).select("*").maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Review not found." });
          return;
        }
        const item2 = mapReviewRow(updated);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "review_updated",
          entityType: "review",
          entityId: item2.id,
          summary: `Updated review for ${item2.reviewer} (${item2.publicationStatus}).`
        });
        res.json({ item: item2 });
        return;
      }
      const db = getDbState();
      const item = db.reviews.find((r) => r.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: "Review not found." });
        return;
      }
      if (req.body?.reviewer !== void 0) item.reviewer = sanitizeText(req.body.reviewer, 120);
      if (req.body?.organization !== void 0) item.organization = sanitizeText(req.body.organization, 140);
      if (req.body?.role !== void 0) item.role = sanitizeText(req.body.role, 120);
      if (req.body?.rating !== void 0) item.rating = Math.min(5, Math.max(1, Number(req.body.rating) || 5));
      if (req.body?.comment !== void 0) item.comment = sanitizeText(req.body.comment, 2e3);
      if (req.body?.serviceTag !== void 0) item.serviceTag = sanitizeText(req.body.serviceTag, 140);
      if (req.body?.dateLabel !== void 0) item.dateLabel = sanitizeText(req.body.dateLabel, 60);
      if (["Pending", "Approved", "Published", "Hidden"].includes(req.body?.publicationStatus)) {
        item.publicationStatus = req.body.publicationStatus;
      }
      if (req.body?.sortOrder !== void 0) item.sortOrder = Number(req.body.sortOrder) || item.sortOrder;
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "review_updated",
        entityType: "review",
        entityId: item.id,
        summary: `Updated review for ${item.reviewer} (${item.publicationStatus}).`
      });
      saveDbState(db);
      res.json({ item });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/admin/reviews/:id", requireAdmin, requirePermission("reviews.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Review not found." });
          return;
        }
        const { data: existing } = await sb.from("reviews").select("id, reviewer_name").eq("id", req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: "Review not found." });
          return;
        }
        const { error: delErr } = await sb.from("reviews").delete().eq("id", req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "review_deleted",
          entityType: "review",
          entityId: existing.id,
          summary: `Deleted review for ${existing.reviewer_name}.`
        });
        res.json({ ok: true });
        return;
      }
      const db = getDbState();
      const idx = db.reviews.findIndex((r) => r.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: "Review not found." });
        return;
      }
      const [removed] = db.reviews.splice(idx, 1);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "review_deleted",
        entityType: "review",
        entityId: removed.id,
        summary: `Deleted review for ${removed.reviewer}.`
      });
      saveDbState(db);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/messages", requireAdmin, requirePermission("messages.manage"), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 30);
      const q = sanitizeText(req.query.q, 120).toLowerCase();
      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const { data, error } = await sb.from("messages").select("*").order("created_at", { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        allItems = (data ?? []).map((r) => mapMessageRow(r));
      } else {
        allItems = getDbState().messages;
      }
      const items = allItems.filter((m) => {
        if (status && status !== "All" && m.status !== status) return false;
        if (q) {
          const hay = `${m.senderName} ${m.senderEmail} ${m.senderPhone} ${m.subject} ${m.body}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/messages/:id", requireAdmin, requirePermission("messages.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Message not found." });
          return;
        }
        const updates = {};
        if (["Unread", "Read", "Responded", "Archived"].includes(req.body?.status)) updates.status = req.body.status;
        if (req.body?.internalNotes !== void 0) updates.internal_notes = sanitizeText(req.body.internalNotes, 2e3);
        if (req.body?.linkedClientId !== void 0) updates.linked_client_id = req.body.linkedClientId || null;
        if (req.body?.linkedBidRequestId !== void 0) updates.linked_bid_request_id = req.body.linkedBidRequestId || null;
        if (req.body?.linkedWorkOrderId !== void 0) updates.linked_work_order_id = req.body.linkedWorkOrderId || null;
        if (req.body?.linkedDispatchId !== void 0) updates.linked_dispatch_id = req.body.linkedDispatchId || null;
        const { data: updated, error: updErr } = await sb.from("messages").update(updates).eq("id", req.params.id).select("*").maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Message not found." });
          return;
        }
        res.json({ item: mapMessageRow(updated) });
        return;
      }
      const db = getDbState();
      const msg = db.messages.find((m) => m.id === req.params.id);
      if (!msg) {
        res.status(404).json({ error: "Message not found." });
        return;
      }
      if (["Unread", "Read", "Responded", "Archived"].includes(req.body?.status)) msg.status = req.body.status;
      if (req.body?.internalNotes !== void 0) msg.internalNotes = sanitizeText(req.body.internalNotes, 2e3);
      if (req.body?.linkedClientId !== void 0) msg.linkedClientId = req.body.linkedClientId || null;
      if (req.body?.linkedBidRequestId !== void 0) msg.linkedBidRequestId = req.body.linkedBidRequestId || null;
      if (req.body?.linkedWorkOrderId !== void 0) msg.linkedWorkOrderId = req.body.linkedWorkOrderId || null;
      if (req.body?.linkedDispatchId !== void 0) msg.linkedDispatchId = req.body.linkedDispatchId || null;
      msg.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      saveDbState(db);
      res.json({ item: msg });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/reports", requireAdmin, requirePermission("reports.view"), async (req, res, next) => {
    try {
      const range = sanitizeText(req.query.range, 20) || "all";
      const fromStr = sanitizeText(req.query.from, 40);
      const toStr = sanitizeText(req.query.to, 40);
      const { start, end } = range === "all" ? { start: 0, end: Date.now() + 864e5 } : computeDateCutoff(range, fromStr, toStr);
      const inRange = (iso) => {
        const ts = new Date(iso).getTime();
        return ts >= start && ts <= end;
      };
      const sb = getSupabaseAdminClient();
      let allWorkOrders;
      let allBids;
      let allDispatches;
      let vendors;
      let clients;
      if (sb) {
        const [woRes, bidRes, dispRes, vndRes, cliRes] = await Promise.all([
          sb.from("work_orders").select("*").eq("is_archived", false),
          sb.from("bid_requests").select("*"),
          sb.from("dispatch_requests").select("*"),
          sb.from("vendors").select("*"),
          sb.from("clients").select("*")
        ]);
        const firstErr = woRes.error || bidRes.error || dispRes.error || vndRes.error || cliRes.error;
        if (firstErr) {
          res.status(500).json({ error: firstErr.message });
          return;
        }
        vendors = (vndRes.data ?? []).map((r) => mapVendorRow(r));
        const vendorNames = new Map(vendors.map((v) => [v.id, v.companyName]));
        allWorkOrders = (woRes.data ?? []).map((r) => mapWorkOrderRow(r, vendorNames));
        allBids = (bidRes.data ?? []).map((r) => mapBidRequestRow(r));
        allDispatches = (dispRes.data ?? []).map((r) => mapDispatchRow(r, vendorNames));
        clients = (cliRes.data ?? []).map((r) => mapClientRow(r));
      } else {
        const db = getDbState();
        allWorkOrders = db.workOrders.filter((w) => !w.isArchived);
        allBids = db.bidRequests;
        allDispatches = db.dispatchRequests;
        vendors = db.vendors;
        clients = db.clients;
      }
      const workOrders = allWorkOrders.filter((w) => inRange(w.createdDate));
      const bids = allBids.filter((b) => inRange(b.createdAt));
      const dispatches = allDispatches.filter((d) => inRange(d.submittedDate));
      const totalCompleted = workOrders.filter((w) => w.status === "Completed" || w.status === "QC Verified").length;
      const slaMet = workOrders.filter((w) => {
        if (!w.completionDate || !w.slaDeadline) return false;
        return new Date(w.completionDate).getTime() <= new Date(w.slaDeadline).getTime();
      }).length;
      const serviceMap = {};
      for (const wo of workOrders) {
        if (!serviceMap[wo.serviceCategory]) {
          serviceMap[wo.serviceCategory] = { category: wo.serviceCategory, count: 0, totalBudget: 0 };
        }
        serviceMap[wo.serviceCategory].count += 1;
        serviceMap[wo.serviceCategory].totalBudget += wo.approvedBudget ?? wo.estimatedBudget;
      }
      res.json({
        summary: {
          workOrdersCount: workOrders.length,
          completionRate: workOrders.length ? Math.round(totalCompleted / workOrders.length * 100) : 0,
          slaComplianceCount: slaMet,
          bidRequestsCount: bids.length,
          bidConversionRate: bids.length ? Math.round(bids.filter((b) => b.status === "Converted").length / bids.length * 100) : 0,
          dispatchesCount: dispatches.length,
          resolvedDispatches: dispatches.filter((d) => d.status === "Resolved" || d.status === "Closed").length,
          totalJobValue: workOrders.reduce((s, w) => s + (w.approvedBudget ?? w.estimatedBudget), 0),
          activeClientsCount: clients.filter((c) => c.accountStatus === "active").length,
          approvedVendorsCount: vendors.filter((v) => v.applicationStatus === "Approved").length
        },
        serviceReport: Object.values(serviceMap),
        vendorReport: vendors.map((v) => ({
          id: v.id,
          vendorCode: v.vendorCode,
          companyName: v.companyName,
          applicationStatus: v.applicationStatus,
          completedWorkOrders: v.completedWorkOrders,
          assignedActive: workOrders.filter((w) => w.assignedVendorId === v.id).length,
          rating: v.rating
        })),
        clientReport: clients.map((c) => ({
          id: c.id,
          clientCode: c.clientCode,
          name: c.companyName || c.contactName,
          clientType: c.clientType,
          workOrdersCount: workOrders.filter((w) => w.clientId === c.id).length,
          totalBudget: workOrders.filter((w) => w.clientId === c.id).reduce((s, w) => s + (w.approvedBudget ?? w.estimatedBudget), 0)
        }))
      });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/reports/export", requireAdmin, requirePermission("reports.export"), async (req, res, next) => {
    try {
      const type = sanitizeText(req.query.type, 40) || "work-orders";
      const sb = getSupabaseAdminClient();
      let csv = "";
      if (type === "vendors") {
        const vendors = sb ? ((await sb.from("vendors").select("*").order("registration_date", { ascending: false })).data ?? []).map(
          (r) => mapVendorRow(r)
        ) : getDbState().vendors;
        csv = rowsToCsv(
          ["Vendor Code", "Company Name", "Contact", "Email", "Phone", "Coverage", "Status", "Completed WOs", "Rating"],
          vendors.map((v) => [
            v.vendorCode,
            v.companyName,
            v.contactPerson,
            v.email,
            v.phone,
            v.coverageAreas,
            v.applicationStatus,
            v.completedWorkOrders,
            v.rating ?? "N/A"
          ])
        );
      } else if (type === "bid-requests") {
        const bids = sb ? ((await sb.from("bid_requests").select("*").order("created_at", { ascending: false })).data ?? []).map(
          (r) => mapBidRequestRow(r)
        ) : getDbState().bidRequests;
        csv = rowsToCsv(
          ["Request Code", "Contact", "Email", "Phone", "Address", "Services", "Status", "Created"],
          bids.map((b) => [
            b.requestCode,
            b.contactName,
            b.email,
            b.phone,
            b.propertyAddress,
            b.requestedServices,
            b.status,
            b.createdAt
          ])
        );
      } else if (type === "dispatch") {
        const dispatches = sb ? await (async () => {
          const [dRes, vNames] = await Promise.all([
            sb.from("dispatch_requests").select("*").order("submitted_at", { ascending: false }),
            getVendorNameMap(sb)
          ]);
          return (dRes.data ?? []).map((r) => mapDispatchRow(r, vNames));
        })() : getDbState().dispatchRequests;
        csv = rowsToCsv(
          ["Dispatch Code", "Contact", "Phone", "Address", "Emergency Type", "Priority", "Status", "Assigned Vendor", "Submitted"],
          dispatches.map((d) => [
            d.dispatchCode,
            d.contactName,
            d.phone,
            d.propertyAddress,
            d.emergencyType,
            d.priority,
            d.status,
            d.assignedVendorName || "Unassigned",
            d.submittedDate
          ])
        );
      } else {
        const workOrders = sb ? await (async () => {
          const [wRes, vNames] = await Promise.all([
            sb.from("work_orders").select("*").order("created_at", { ascending: false }),
            getVendorNameMap(sb)
          ]);
          return (wRes.data ?? []).map((r) => mapWorkOrderRow(r, vNames));
        })() : getDbState().workOrders;
        csv = rowsToCsv(
          ["Work Order Code", "Client", "Client Type", "Address", "City", "State", "Category", "Priority", "Status", "Estimated Budget", "Approved Budget", "Assigned Vendor", "SLA Deadline", "Demo"],
          workOrders.map((w) => [
            w.workOrderCode,
            w.clientName,
            w.clientType,
            w.propertyAddress,
            w.city,
            w.state,
            w.serviceCategory,
            w.priority,
            w.status,
            w.estimatedBudget,
            w.approvedBudget ?? "",
            w.assignedVendorName || "Unassigned",
            w.slaDeadline ?? "",
            w.isDemo ? "Yes" : "No"
          ])
        );
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="slc-${type}-report.csv"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/notifications", requireAdmin, async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const [itemsRes, countRes] = await Promise.all([
          sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(60),
          sb.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false)
        ]);
        if (itemsRes.error) {
          res.status(500).json({ error: itemsRes.error.message });
          return;
        }
        res.json({
          items: (itemsRes.data ?? []).map((r) => mapNotificationRow(r)),
          unreadCount: countRes.count ?? 0
        });
        return;
      }
      const db = getDbState();
      res.json({
        items: db.notifications.slice(0, 60),
        unreadCount: db.notifications.filter((n) => !n.isRead).length
      });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/notifications/:id/read", requireAdmin, async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (isUuid(req.params.id)) {
          await sb.from("notifications").update({ is_read: true }).eq("id", req.params.id);
        }
        res.json({ ok: true });
        return;
      }
      const db = getDbState();
      const n = db.notifications.find((item) => item.id === req.params.id);
      if (n) {
        n.isRead = true;
        saveDbState(db);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/notifications/read-all", requireAdmin, async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        await sb.from("notifications").update({ is_read: true }).eq("is_read", false);
        res.json({ ok: true });
        return;
      }
      const db = getDbState();
      for (const n of db.notifications) n.isRead = true;
      saveDbState(db);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/activity-logs", requireAdmin, requirePermission("audit.view"), async (req, res, next) => {
    try {
      const entityType = sanitizeText(req.query.entityType, 40);
      const sb = getSupabaseAdminClient();
      if (sb) {
        let query = sb.from("admin_activity_logs").select("*").order("created_at", { ascending: false }).limit(250);
        if (entityType && entityType !== "All") {
          query = query.eq("entity_type", entityType);
        }
        const { data, error } = await query;
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapActivityLogRow(r)) });
        return;
      }
      const db = getDbState();
      const items = db.activityLogs.filter((l) => !entityType || entityType === "All" || l.entityType === entityType);
      res.json({ items: items.slice(0, 250) });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/settings", requireAdmin, async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const [businessSettings, notificationPreferences] = await Promise.all([
          getSupabaseBusinessSettings(sb),
          getSupabaseNotificationPrefs(sb, req.adminUser.id)
        ]);
        res.json({
          businessSettings,
          notificationPreferences,
          emailServiceConfigured: isEmailServiceConfigured()
        });
        return;
      }
      const db = getDbState();
      const prefs = db.notificationPreferences[req.adminUser.id] ?? {
        emailEnabled: false,
        events: { ...DEFAULT_NOTIFICATION_EVENTS }
      };
      res.json({
        businessSettings: db.businessSettings,
        notificationPreferences: prefs,
        emailServiceConfigured: isEmailServiceConfigured()
      });
    } catch (err) {
      next(err);
    }
  });
  router.put("/admin/settings", requireAdmin, requirePermission("settings.manage"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const current = await getSupabaseBusinessSettings(sb);
        const payload = {
          id: 1,
          business_name: req.body?.businessName !== void 0 ? sanitizeText(req.body.businessName, 160) : current.businessName,
          phone: req.body?.phone !== void 0 ? sanitizeText(req.body.phone, 40) : current.phone,
          email: req.body?.email !== void 0 && isValidEmail(req.body.email) ? sanitizeText(req.body.email, 254) : current.email,
          address: req.body?.address !== void 0 ? sanitizeText(req.body.address, 240) : current.address,
          hours: req.body?.hours !== void 0 ? sanitizeText(req.body.hours, 160) : current.hours,
          logo_url: req.body?.logoUrl !== void 0 && isSafeMediaUrl(req.body.logoUrl) ? sanitizeText(req.body.logoUrl, 500) : current.logoUrl,
          default_wo_priority: PRIORITY_LEVELS.includes(req.body?.defaultWoPriority) ? req.body.defaultWoPriority : current.defaultWoPriority,
          default_sla_hours: req.body?.defaultSlaHours !== void 0 ? Math.max(4, Number(req.body.defaultSlaHours) || 48) : current.defaultSlaHours,
          auto_notify_urgent: req.body?.autoNotifyUrgent !== void 0 ? Boolean(req.body.autoNotifyUrgent) : current.autoNotifyUrgent,
          coverage_radius_note: req.body?.coverageRadiusNote !== void 0 ? sanitizeText(req.body.coverageRadiusNote, 160) : current.coverageRadiusNote
        };
        const { data: savedRow, error: updErr } = await sb.from("business_settings").upsert(payload, { onConflict: "id" }).select("*").single();
        if (updErr || !savedRow) {
          res.status(500).json({ error: updErr?.message || "Unable to save business settings." });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "settings_updated",
          entityType: "settings",
          entityId: "business_settings",
          summary: "Updated business & SLA settings."
        });
        res.json({ businessSettings: mapSettingsRow(savedRow) });
        return;
      }
      const db = getDbState();
      const s = db.businessSettings;
      if (req.body?.businessName !== void 0) s.businessName = sanitizeText(req.body.businessName, 160);
      if (req.body?.phone !== void 0) s.phone = sanitizeText(req.body.phone, 40);
      if (req.body?.email !== void 0 && isValidEmail(req.body.email)) s.email = sanitizeText(req.body.email, 254);
      if (req.body?.address !== void 0) s.address = sanitizeText(req.body.address, 240);
      if (req.body?.hours !== void 0) s.hours = sanitizeText(req.body.hours, 160);
      if (req.body?.logoUrl !== void 0 && isSafeMediaUrl(req.body.logoUrl)) s.logoUrl = sanitizeText(req.body.logoUrl, 500);
      if (PRIORITY_LEVELS.includes(req.body?.defaultWoPriority)) s.defaultWoPriority = req.body.defaultWoPriority;
      if (req.body?.defaultSlaHours !== void 0) s.defaultSlaHours = Math.max(4, Number(req.body.defaultSlaHours) || 48);
      if (req.body?.autoNotifyUrgent !== void 0) s.autoNotifyUrgent = Boolean(req.body.autoNotifyUrgent);
      if (req.body?.coverageRadiusNote !== void 0) s.coverageRadiusNote = sanitizeText(req.body.coverageRadiusNote, 160);
      s.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "settings_updated",
        entityType: "settings",
        entityId: "business_settings",
        summary: "Updated business & SLA settings."
      });
      saveDbState(db);
      res.json({ businessSettings: s });
    } catch (err) {
      next(err);
    }
  });
  router.put("/admin/notification-preferences", requireAdmin, async (req, res, next) => {
    try {
      const emailEnabled = Boolean(req.body?.emailEnabled);
      const events = typeof req.body?.events === "object" && req.body.events ? req.body.events : {};
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { error: upsertErr } = await sb.from("notification_preferences").upsert(
          {
            profile_id: req.adminUser.id,
            email_enabled: emailEnabled,
            events_config: events
          },
          { onConflict: "profile_id" }
        );
        if (upsertErr) {
          res.status(500).json({ error: upsertErr.message });
          return;
        }
        res.json({ notificationPreferences: { emailEnabled, events } });
        return;
      }
      const db = getDbState();
      db.notificationPreferences[req.adminUser.id] = { emailEnabled, events };
      saveDbState(db);
      res.json({ notificationPreferences: db.notificationPreferences[req.adminUser.id] });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/files/:bucket/:filename", requireAdmin, async (req, res, next) => {
    try {
      const bucket = sanitizeText(req.params.bucket, 40);
      const filename = sanitizeText(req.params.filename, 180);
      if (!["work-order-attachments", "vendor-documents", "dispatch-attachments", "gallery"].includes(bucket)) {
        res.status(400).json({ error: "Invalid bucket." });
        return;
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
        res.status(400).json({ error: "Invalid filename." });
        return;
      }
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb.storage.from(bucket).download(filename);
        if (error || !data) {
          res.status(404).json({ error: "File not found in storage." });
          return;
        }
        const buf = Buffer.from(await data.arrayBuffer());
        res.setHeader("Content-Type", data.type || "application/octet-stream");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(buf);
        return;
      }
      if (isProductionEnvironment()) {
        res.status(503).json({ error: "Supabase Storage is required in production." });
        return;
      }
      const safePath = resolveSafeFilePath(UPLOADS_ROOT, bucket, filename);
      if (!safePath || !fs3.existsSync(safePath)) {
        res.status(404).json({ error: "File not found." });
        return;
      }
      res.sendFile(safePath);
    } catch (err) {
      next(err);
    }
  });
}

// server/routes/operationsRoutes.ts
import crypto7 from "node:crypto";
function registerOperationsRoutes(router) {
  router.get("/admin/dashboard", requireAdmin, requirePermission("dashboard.view"), async (req, res, next) => {
    try {
      const range = sanitizeText(req.query.range, 20) || "30d";
      const fromStr = sanitizeText(req.query.from, 40);
      const toStr = sanitizeText(req.query.to, 40);
      const { start, end } = computeDateCutoff(range, fromStr, toStr);
      const inRange = (iso) => {
        const ts = new Date(iso).getTime();
        return ts >= start && ts <= end;
      };
      const sb = getSupabaseAdminClient();
      let allWOs;
      let bidRequests;
      let dispatchRequests;
      let vendors;
      let clients;
      let activityLogs;
      if (sb) {
        const [woRes, bidRes, dispRes, vndRes, cliRes, actRes] = await Promise.all([
          sb.from("work_orders").select("*").eq("is_archived", false).order("created_at", { ascending: false }),
          sb.from("bid_requests").select("*").order("created_at", { ascending: false }),
          sb.from("dispatch_requests").select("*").order("submitted_at", { ascending: false }),
          sb.from("vendors").select("*").order("registration_date", { ascending: false }),
          sb.from("clients").select("*").order("created_at", { ascending: false }),
          sb.from("admin_activity_logs").select("*").order("created_at", { ascending: false }).limit(8)
        ]);
        const firstErr = woRes.error || bidRes.error || dispRes.error || vndRes.error || cliRes.error || actRes.error;
        if (firstErr) {
          res.status(500).json({ error: `Unable to load dashboard metrics: ${firstErr.message}` });
          return;
        }
        vendors = (vndRes.data ?? []).map((r) => mapVendorRow(r));
        const vendorNames = new Map(vendors.map((v) => [v.id, v.companyName]));
        allWOs = (woRes.data ?? []).map((r) => mapWorkOrderRow(r, vendorNames));
        bidRequests = (bidRes.data ?? []).map((r) => mapBidRequestRow(r));
        dispatchRequests = (dispRes.data ?? []).map((r) => mapDispatchRow(r, vendorNames));
        clients = (cliRes.data ?? []).map((r) => mapClientRow(r));
        activityLogs = (actRes.data ?? []).map((r) => mapActivityLogRow(r));
      } else {
        const db = getDbState();
        allWOs = db.workOrders.filter((w) => !w.isArchived);
        bidRequests = db.bidRequests;
        dispatchRequests = db.dispatchRequests;
        vendors = db.vendors;
        clients = db.clients;
        activityLogs = db.activityLogs.slice(0, 8);
      }
      const filteredWOs = range === "all" ? allWOs : allWOs.filter((w) => inRange(w.createdDate));
      const filteredBids = range === "all" ? bidRequests : bidRequests.filter((b) => inRange(b.createdAt));
      const filteredDispatch = range === "all" ? dispatchRequests : dispatchRequests.filter((d) => inRange(d.submittedDate));
      const nowMs = Date.now();
      const upcomingCutoff = nowMs + 48 * 3600 * 1e3;
      const closedStatuses = /* @__PURE__ */ new Set(["Completed", "Cancelled", "QC Verified"]);
      const overdueWOs = allWOs.filter(
        (w) => w.slaDeadline && new Date(w.slaDeadline).getTime() < nowMs && !closedStatuses.has(w.status)
      );
      const upcomingSlaWOs = allWOs.filter(
        (w) => w.slaDeadline && new Date(w.slaDeadline).getTime() >= nowMs && new Date(w.slaDeadline).getTime() <= upcomingCutoff && !closedStatuses.has(w.status)
      ).sort((a, b) => new Date(a.slaDeadline).getTime() - new Date(b.slaDeadline).getTime());
      const statusCounts = {};
      const categoryCounts = {};
      const monthlyCounts = {};
      for (const wo of filteredWOs) {
        statusCounts[wo.status] = (statusCounts[wo.status] || 0) + 1;
        categoryCounts[wo.serviceCategory] = (categoryCounts[wo.serviceCategory] || 0) + 1;
        const d = new Date(wo.createdDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        if (!monthlyCounts[key]) {
          monthlyCounts[key] = { month: label, count: 0, value: 0 };
        }
        monthlyCounts[key].count += 1;
        monthlyCounts[key].value += wo.approvedBudget ?? wo.estimatedBudget;
      }
      const totalEstimatedValue = filteredWOs.reduce((sum, w) => sum + (w.approvedBudget ?? w.estimatedBudget), 0);
      const vendorPerformance = vendors.filter((v) => v.applicationStatus === "Approved").map((v) => {
        const assigned = allWOs.filter((w) => w.assignedVendorId === v.id);
        return {
          id: v.id,
          companyName: v.companyName,
          completedWorkOrders: v.completedWorkOrders + assigned.filter((w) => closedStatuses.has(w.status)).length,
          activeAssigned: assigned.filter((w) => !closedStatuses.has(w.status)).length,
          rating: v.rating
        };
      }).sort((a, b) => b.completedWorkOrders - a.completedWorkOrders).slice(0, 6);
      res.json({
        metrics: {
          totalWorkOrders: filteredWOs.length,
          openWorkOrders: filteredWOs.filter((w) => ["Open Bid", "Bid Review", "Approved", "Dispatched", "Scheduled"].includes(w.status)).length,
          newWorkOrders: filteredWOs.filter((w) => w.status === "New").length,
          inProgressWorkOrders: filteredWOs.filter((w) => w.status === "In Progress").length,
          completedWorkOrders: filteredWOs.filter((w) => w.status === "Completed").length,
          qcVerifiedWorkOrders: filteredWOs.filter((w) => w.status === "QC Verified").length,
          urgentDispatchRequests: filteredDispatch.filter((d) => !["Resolved", "Closed"].includes(d.status)).length,
          pendingBidRequests: filteredBids.filter((b) => ["New", "Pending Review", "Estimating"].includes(b.status) && !b.isArchived).length,
          totalVendors: vendors.length,
          pendingVendorApplications: vendors.filter((v) => v.applicationStatus === "Pending" || v.applicationStatus === "Under Review").length,
          activeClients: clients.filter((c) => c.accountStatus === "active").length,
          totalEstimatedValue,
          upcomingSlaDeadlines: upcomingSlaWOs.length,
          overdueWorkOrders: overdueWOs.length
        },
        charts: {
          statusDistribution: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
          monthlyWorkOrders: Object.entries(monthlyCounts).sort(([a], [b]) => a.localeCompare(b)).map(([, val]) => val),
          categoryBreakdown: Object.entries(categoryCounts).map(([category, count]) => ({ category, count })),
          vendorPerformance
        },
        lists: {
          recentActivity: activityLogs,
          recentBidRequests: bidRequests.filter((b) => !b.isArchived).slice(0, 5),
          recentDispatchRequests: dispatchRequests.slice(0, 5),
          upcomingSlaDeadlines: upcomingSlaWOs.slice(0, 6),
          overdueWorkOrders: overdueWOs.slice(0, 6),
          recentClients: clients.filter((c) => c.accountStatus === "active").slice(0, 5)
        }
      });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/work-orders", requireAdmin, requirePermission("work_orders.read"), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 40);
      const priority = sanitizeText(req.query.priority, 20);
      const q = sanitizeText(req.query.q, 120).toLowerCase();
      const includeArchived = req.query.archived === "true";
      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        let query = sb.from("work_orders").select("*").order("created_at", { ascending: false });
        if (!includeArchived) query = query.eq("is_archived", false);
        const [woRes, vendorNames] = await Promise.all([query, getVendorNameMap(sb)]);
        if (woRes.error) {
          res.status(500).json({ error: `Failed to load work orders: ${woRes.error.message}` });
          return;
        }
        allItems = (woRes.data ?? []).map((r) => mapWorkOrderRow(r, vendorNames));
      } else {
        allItems = getDbState().workOrders;
      }
      const items = allItems.filter((w) => {
        if (!includeArchived && w.isArchived) return false;
        if (status && status !== "All" && w.status !== status) return false;
        if (priority && priority !== "All" && w.priority !== priority) return false;
        if (q) {
          const hay = `${w.workOrderCode} ${w.clientName} ${w.propertyAddress} ${w.city} ${w.state} ${w.serviceDescription} ${w.assignedVendorName}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/work-orders", requireAdmin, requirePermission("work_orders.write"), async (req, res, next) => {
    try {
      const clientId = sanitizeText(req.body?.clientId, 80) || null;
      const propertyAddress = sanitizeText(req.body?.propertyAddress, 240);
      const city = sanitizeText(req.body?.city, 80);
      const stateCode = sanitizeText(req.body?.state, 40);
      const serviceCategory = sanitizeText(req.body?.serviceCategory, 140);
      const serviceDescription = sanitizeText(req.body?.serviceDescription, 2e3);
      const clientTypeRaw = sanitizeText(req.body?.clientType, 60);
      const priorityRaw = sanitizeText(req.body?.priority, 20);
      const statusRaw = sanitizeText(req.body?.status, 40);
      const vendorId = sanitizeText(req.body?.assignedVendorId, 80) || null;
      const code = `SLC-${(/* @__PURE__ */ new Date()).getFullYear().toString().slice(-2)}-${Math.floor(4200 + Math.random() * 5700)}`;
      if (!propertyAddress || !city || !stateCode || !serviceCategory || !serviceDescription) {
        res.status(400).json({ error: "Property address, city, state, service category, and description are required." });
        return;
      }
      const sb = getSupabaseAdminClient();
      if (sb) {
        const settings = await getSupabaseBusinessSettings(sb);
        let linkedClient2 = null;
        if (clientId && isUuid(clientId)) {
          const { data } = await sb.from("clients").select("*").eq("id", clientId).maybeSingle();
          linkedClient2 = data ?? null;
        }
        let linkedVendor2 = null;
        if (vendorId && isUuid(vendorId)) {
          const { data } = await sb.from("vendors").select("id, company_name").eq("id", vendorId).maybeSingle();
          linkedVendor2 = data ?? null;
        }
        const resolvedClientType = CLIENT_TYPES.includes(clientTypeRaw) ? clientTypeRaw : linkedClient2?.client_type || "Property Manager";
        const resolvedPriority = PRIORITY_LEVELS.includes(priorityRaw) ? priorityRaw : settings.defaultWoPriority;
        const resolvedStatus = WORK_ORDER_STATUSES.includes(statusRaw) ? statusRaw : linkedVendor2 ? "Dispatched" : "New";
        const slaDeadline = sanitizeText(req.body?.slaDeadline, 40) || new Date(Date.now() + settings.defaultSlaHours * 3600 * 1e3).toISOString();
        const { data: inserted, error: insErr } = await sb.from("work_orders").insert({
          work_order_code: code,
          client_id: linkedClient2 ? String(linkedClient2.id) : null,
          client_name: linkedClient2?.company_name || linkedClient2?.contact_name || sanitizeText(req.body?.clientName, 140) || "Direct Client",
          client_type: resolvedClientType,
          property_address: propertyAddress,
          city,
          state: stateCode,
          zip_code: sanitizeText(req.body?.zipCode, 20),
          county: sanitizeText(req.body?.county, 80),
          lat: req.body?.lat != null && req.body.lat !== "" ? Number(req.body.lat) : null,
          lng: req.body?.lng != null && req.body.lng !== "" ? Number(req.body.lng) : null,
          service_category: serviceCategory,
          service_description: serviceDescription,
          priority: resolvedPriority,
          estimated_budget: Number(req.body?.estimatedBudget) || 0,
          approved_budget: req.body?.approvedBudget != null && req.body.approvedBudget !== "" ? Number(req.body.approvedBudget) : null,
          assigned_vendor_id: linkedVendor2 ? String(linkedVendor2.id) : null,
          scheduled_date: sanitizeText(req.body?.scheduledDate, 40) || null,
          sla_deadline: slaDeadline,
          status: resolvedStatus,
          qc_notes: "",
          is_archived: false,
          is_demo: false
        }).select("*").single();
        if (insErr || !inserted) {
          res.status(500).json({ error: `Failed to create work order: ${insErr?.message || "Unknown error"}` });
          return;
        }
        const vendorNames = /* @__PURE__ */ new Map();
        if (linkedVendor2) vendorNames.set(String(linkedVendor2.id), String(linkedVendor2.company_name));
        const wo2 = mapWorkOrderRow(inserted, vendorNames);
        await Promise.all([
          insertSupabaseWorkOrderTimeline(
            sb,
            wo2.id,
            req.adminUser.fullName,
            "created",
            `Work order ${code} created (${wo2.status}).`
          ),
          insertSupabaseNotification(sb, {
            eventType: "new_work_order",
            title: `Work Order ${code} Created`,
            message: `${wo2.serviceCategory} at ${wo2.propertyAddress}, ${wo2.city}, ${wo2.state}.`,
            entityType: "work_order",
            entityId: wo2.id
          }),
          insertSupabaseAuditLog(sb, {
            actorId: req.adminUser.id,
            actorEmail: req.adminUser.email,
            actorRole: req.adminUser.role,
            action: "work_order_created",
            entityType: "work_order",
            entityId: wo2.id,
            summary: `Created work order ${code} for ${wo2.propertyAddress}.`
          })
        ]);
        res.status(201).json({ item: wo2 });
        return;
      }
      const db = getDbState();
      const linkedClient = clientId ? db.clients.find((c) => c.id === clientId) : void 0;
      const linkedVendor = vendorId ? db.vendors.find((v) => v.id === vendorId) : void 0;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const id = crypto7.randomUUID();
      const wo = {
        id,
        workOrderCode: code,
        clientId: linkedClient?.id ?? null,
        clientName: linkedClient?.companyName || linkedClient?.contactName || sanitizeText(req.body?.clientName, 140) || "Direct Client",
        clientType: CLIENT_TYPES.includes(clientTypeRaw) ? clientTypeRaw : "Property Manager",
        propertyAddress,
        city,
        state: stateCode,
        zipCode: sanitizeText(req.body?.zipCode, 20),
        county: sanitizeText(req.body?.county, 80),
        lat: req.body?.lat != null && req.body.lat !== "" ? Number(req.body.lat) : null,
        lng: req.body?.lng != null && req.body.lng !== "" ? Number(req.body.lng) : null,
        serviceCategory,
        serviceDescription,
        priority: PRIORITY_LEVELS.includes(priorityRaw) ? priorityRaw : db.businessSettings.defaultWoPriority,
        estimatedBudget: Number(req.body?.estimatedBudget) || 0,
        approvedBudget: req.body?.approvedBudget != null && req.body.approvedBudget !== "" ? Number(req.body.approvedBudget) : null,
        assignedVendorId: linkedVendor?.id ?? null,
        assignedVendorName: linkedVendor?.companyName ?? "",
        createdDate: now,
        scheduledDate: sanitizeText(req.body?.scheduledDate, 40) || null,
        slaDeadline: sanitizeText(req.body?.slaDeadline, 40) || new Date(Date.now() + db.businessSettings.defaultSlaHours * 3600 * 1e3).toISOString(),
        completionDate: null,
        status: WORK_ORDER_STATUSES.includes(statusRaw) ? statusRaw : linkedVendor ? "Dispatched" : "New",
        qcNotes: "",
        isArchived: false,
        isDemo: false,
        updatedAt: now
      };
      db.workOrders.unshift(wo);
      appendWorkOrderTimeline(db, wo.id, req.adminUser.fullName, "created", `Work order ${code} created (${wo.status}).`);
      appendNotification(db, {
        eventType: "new_work_order",
        title: `Work Order ${code} Created`,
        message: `${wo.serviceCategory} at ${wo.propertyAddress}, ${wo.city}, ${wo.state}.`,
        entityType: "work_order",
        entityId: wo.id
      });
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "work_order_created",
        entityType: "work_order",
        entityId: wo.id,
        summary: `Created work order ${code} for ${wo.propertyAddress}.`
      });
      saveDbState(db);
      res.status(201).json({ item: wo });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/work-orders/:id", requireAdmin, requirePermission("work_orders.read"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const param = req.params.id;
        let woQuery = sb.from("work_orders").select("*");
        woQuery = isUuid(param) ? woQuery.eq("id", param) : woQuery.eq("work_order_code", param);
        const { data: woRow, error: woErr } = await woQuery.maybeSingle();
        if (woErr) {
          res.status(500).json({ error: `Failed to fetch work order: ${woErr.message}` });
          return;
        }
        if (!woRow) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const woId = String(woRow.id);
        const woCode = String(woRow.work_order_code ?? "");
        const [vendorNames, profileNames, clientRes, vendorRes, notesRes, attRes, tlRes, bidsRes, actRes] = await Promise.all([
          getVendorNameMap(sb),
          getProfileNameMap(sb),
          woRow.client_id ? sb.from("clients").select("*").eq("id", woRow.client_id).maybeSingle() : Promise.resolve({ data: null }),
          woRow.assigned_vendor_id ? sb.from("vendors").select("*").eq("id", woRow.assigned_vendor_id).maybeSingle() : Promise.resolve({ data: null }),
          sb.from("work_order_notes").select("*").eq("work_order_id", woId).order("created_at", { ascending: false }),
          sb.from("work_order_attachments").select("*").eq("work_order_id", woId).order("created_at", { ascending: false }),
          sb.from("work_order_timeline").select("*").eq("work_order_id", woId).order("created_at", { ascending: false }),
          sb.from("vendor_bids").select("*").eq("work_order_id", woId).order("submitted_at", { ascending: false }),
          sb.from("admin_activity_logs").select("*").eq("entity_type", "work_order").eq("entity_id", woId).order("created_at", { ascending: false })
        ]);
        const woCodeMap = /* @__PURE__ */ new Map([[woId, woCode]]);
        res.json({
          item: mapWorkOrderRow(woRow, vendorNames),
          client: clientRes.data ? mapClientRow(clientRes.data) : null,
          vendor: vendorRes.data ? mapVendorRow(vendorRes.data) : null,
          notes: (notesRes.data ?? []).map((r) => mapWorkOrderNoteRow(r)),
          attachments: (attRes.data ?? []).map((r) => mapWorkOrderAttachmentRow(r, profileNames)),
          timeline: (tlRes.data ?? []).map((r) => mapWorkOrderTimelineRow(r)),
          bids: (bidsRes.data ?? []).map((r) => mapVendorBidRow(r, woCodeMap)),
          activity: (actRes.data ?? []).map((r) => mapActivityLogRow(r))
        });
        return;
      }
      const db = getDbState();
      const wo = db.workOrders.find((w) => w.id === req.params.id || w.workOrderCode === req.params.id);
      if (!wo) {
        res.status(404).json({ error: "Work order not found." });
        return;
      }
      const client = wo.clientId ? db.clients.find((c) => c.id === wo.clientId) ?? null : null;
      const vendor = wo.assignedVendorId ? db.vendors.find((v) => v.id === wo.assignedVendorId) ?? null : null;
      const notes = db.workOrderNotes.filter((n) => n.workOrderId === wo.id);
      const attachments = db.workOrderAttachments.filter((a) => a.workOrderId === wo.id);
      const timeline = db.workOrderTimeline.filter((t) => t.workOrderId === wo.id);
      const bids = db.vendorBids.filter((b) => b.workOrderId === wo.id);
      const activity = db.activityLogs.filter((l) => l.entityType === "work_order" && l.entityId === wo.id);
      res.json({ item: wo, client, vendor, notes, attachments, timeline, bids, activity });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/work-orders/:id", requireAdmin, requirePermission("work_orders.write"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const { data: existing, error: fetchErr } = await sb.from("work_orders").select("*").eq("id", req.params.id).maybeSingle();
        if (fetchErr) {
          res.status(500).json({ error: fetchErr.message });
          return;
        }
        if (!existing) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const prevStatus2 = existing.status;
        const updates = {};
        if (req.body?.clientName !== void 0) updates.client_name = sanitizeText(req.body.clientName, 140);
        if (req.body?.clientId !== void 0) {
          const cid = sanitizeText(req.body.clientId, 80) || null;
          updates.client_id = cid && isUuid(cid) ? cid : null;
          if (cid && isUuid(cid)) {
            const { data: c } = await sb.from("clients").select("company_name, contact_name, client_type").eq("id", cid).maybeSingle();
            if (c) {
              updates.client_name = c.company_name || c.contact_name;
              updates.client_type = c.client_type;
            }
          }
        }
        if (req.body?.clientType && CLIENT_TYPES.includes(req.body.clientType)) updates.client_type = req.body.clientType;
        if (req.body?.propertyAddress !== void 0) updates.property_address = sanitizeText(req.body.propertyAddress, 240);
        if (req.body?.city !== void 0) updates.city = sanitizeText(req.body.city, 80);
        if (req.body?.state !== void 0) updates.state = sanitizeText(req.body.state, 40);
        if (req.body?.zipCode !== void 0) updates.zip_code = sanitizeText(req.body.zipCode, 20);
        if (req.body?.county !== void 0) updates.county = sanitizeText(req.body.county, 80);
        if (req.body?.serviceCategory !== void 0) updates.service_category = sanitizeText(req.body.serviceCategory, 140);
        if (req.body?.serviceDescription !== void 0) updates.service_description = sanitizeText(req.body.serviceDescription, 2e3);
        if (req.body?.priority && PRIORITY_LEVELS.includes(req.body.priority)) updates.priority = req.body.priority;
        if (req.body?.estimatedBudget !== void 0) updates.estimated_budget = Number(req.body.estimatedBudget) || 0;
        if (req.body?.approvedBudget !== void 0) {
          updates.approved_budget = req.body.approvedBudget === null || req.body.approvedBudget === "" ? null : Number(req.body.approvedBudget);
        }
        if (req.body?.scheduledDate !== void 0) updates.scheduled_date = req.body.scheduledDate || null;
        if (req.body?.slaDeadline !== void 0) updates.sla_deadline = req.body.slaDeadline || null;
        if (req.body?.status && WORK_ORDER_STATUSES.includes(req.body.status)) {
          updates.status = req.body.status;
          if (req.body.status === "Completed" || req.body.status === "QC Verified") {
            updates.completion_date = existing.completion_date || (/* @__PURE__ */ new Date()).toISOString();
          }
        }
        if (req.body?.assignedVendorId !== void 0) {
          const vid = sanitizeText(req.body.assignedVendorId, 80) || null;
          updates.assigned_vendor_id = vid && isUuid(vid) ? vid : null;
        }
        if (req.body?.isArchived !== void 0) updates.is_archived = Boolean(req.body.isArchived);
        const { data: updated, error: updErr } = await sb.from("work_orders").update(updates).eq("id", req.params.id).select("*").single();
        if (updErr || !updated) {
          res.status(500).json({ error: updErr?.message || "Unable to update work order." });
          return;
        }
        const vendorNames = await getVendorNameMap(sb);
        const wo2 = mapWorkOrderRow(updated, vendorNames);
        if (wo2.status !== prevStatus2) {
          await insertSupabaseWorkOrderTimeline(
            sb,
            wo2.id,
            req.adminUser.fullName,
            "status_changed",
            `Status changed from ${prevStatus2} to ${wo2.status}.`
          );
          if (wo2.status === "Submitted for QC" || wo2.status === "Completed") {
            await insertSupabaseNotification(sb, {
              eventType: wo2.status === "Completed" ? "work_order_completed" : "work_order_qc_submitted",
              title: `${wo2.workOrderCode}: ${wo2.status}`,
              message: `${wo2.serviceCategory} at ${wo2.propertyAddress} is now ${wo2.status}.`,
              entityType: "work_order",
              entityId: wo2.id
            });
          }
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "work_order_updated",
          entityType: "work_order",
          entityId: wo2.id,
          summary: `Updated work order ${wo2.workOrderCode} (${wo2.status}).`
        });
        res.json({ item: wo2 });
        return;
      }
      const db = getDbState();
      const wo = db.workOrders.find((w) => w.id === req.params.id);
      if (!wo) {
        res.status(404).json({ error: "Work order not found." });
        return;
      }
      const prevStatus = wo.status;
      if (req.body?.clientName !== void 0) wo.clientName = sanitizeText(req.body.clientName, 140);
      if (req.body?.clientId !== void 0) {
        const cid = sanitizeText(req.body.clientId, 80) || null;
        wo.clientId = cid;
        if (cid) {
          const c = db.clients.find((cl) => cl.id === cid);
          if (c) {
            wo.clientName = c.companyName || c.contactName;
            wo.clientType = c.clientType;
          }
        }
      }
      if (req.body?.clientType && CLIENT_TYPES.includes(req.body.clientType)) wo.clientType = req.body.clientType;
      if (req.body?.propertyAddress !== void 0) wo.propertyAddress = sanitizeText(req.body.propertyAddress, 240);
      if (req.body?.city !== void 0) wo.city = sanitizeText(req.body.city, 80);
      if (req.body?.state !== void 0) wo.state = sanitizeText(req.body.state, 40);
      if (req.body?.zipCode !== void 0) wo.zipCode = sanitizeText(req.body.zipCode, 20);
      if (req.body?.county !== void 0) wo.county = sanitizeText(req.body.county, 80);
      if (req.body?.serviceCategory !== void 0) wo.serviceCategory = sanitizeText(req.body.serviceCategory, 140);
      if (req.body?.serviceDescription !== void 0) wo.serviceDescription = sanitizeText(req.body.serviceDescription, 2e3);
      if (req.body?.priority && PRIORITY_LEVELS.includes(req.body.priority)) wo.priority = req.body.priority;
      if (req.body?.estimatedBudget !== void 0) wo.estimatedBudget = Number(req.body.estimatedBudget) || 0;
      if (req.body?.approvedBudget !== void 0) {
        wo.approvedBudget = req.body.approvedBudget === null || req.body.approvedBudget === "" ? null : Number(req.body.approvedBudget);
      }
      if (req.body?.scheduledDate !== void 0) wo.scheduledDate = req.body.scheduledDate || null;
      if (req.body?.slaDeadline !== void 0) wo.slaDeadline = req.body.slaDeadline || null;
      if (req.body?.status && WORK_ORDER_STATUSES.includes(req.body.status)) {
        wo.status = req.body.status;
        if (wo.status === "Completed" || wo.status === "QC Verified") {
          wo.completionDate = wo.completionDate || (/* @__PURE__ */ new Date()).toISOString();
        }
      }
      if (req.body?.assignedVendorId !== void 0) {
        const vid = sanitizeText(req.body.assignedVendorId, 80) || null;
        wo.assignedVendorId = vid;
        const v = vid ? db.vendors.find((vnd) => vnd.id === vid) : void 0;
        wo.assignedVendorName = v ? v.companyName : "";
      }
      if (req.body?.isArchived !== void 0) wo.isArchived = Boolean(req.body.isArchived);
      wo.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (wo.status !== prevStatus) {
        appendWorkOrderTimeline(
          db,
          wo.id,
          req.adminUser.fullName,
          "status_changed",
          `Status changed from ${prevStatus} to ${wo.status}.`
        );
        if (wo.status === "Submitted for QC" || wo.status === "Completed") {
          appendNotification(db, {
            eventType: wo.status === "Completed" ? "work_order_completed" : "work_order_qc_submitted",
            title: `${wo.workOrderCode}: ${wo.status}`,
            message: `${wo.serviceCategory} at ${wo.propertyAddress} is now ${wo.status}.`,
            entityType: "work_order",
            entityId: wo.id
          });
        }
      }
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "work_order_updated",
        entityType: "work_order",
        entityId: wo.id,
        summary: `Updated work order ${wo.workOrderCode} (${wo.status}).`
      });
      saveDbState(db);
      res.json({ item: wo });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/work-orders/:id/qc", requireAdmin, requirePermission("work_orders.qc"), async (req, res, next) => {
    try {
      const decision = sanitizeText(req.body?.decision, 20);
      const qcNotes = sanitizeText(req.body?.qcNotes, 2e3);
      if (!["approve", "reject"].includes(decision)) {
        res.status(400).json({ error: "QC decision must be approve or reject." });
        return;
      }
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const { data: existing } = await sb.from("work_orders").select("id, completion_date, work_order_code").eq("id", req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const nextStatus = decision === "approve" ? "QC Verified" : "QC Rejected";
        const updates = { status: nextStatus, qc_notes: qcNotes };
        if (decision === "approve") {
          updates.completion_date = existing.completion_date || (/* @__PURE__ */ new Date()).toISOString();
        }
        const { data: updated, error: updErr } = await sb.from("work_orders").update(updates).eq("id", req.params.id).select("*").single();
        if (updErr || !updated) {
          res.status(500).json({ error: updErr?.message || "Unable to record QC decision." });
          return;
        }
        const vendorNames = await getVendorNameMap(sb);
        const wo2 = mapWorkOrderRow(updated, vendorNames);
        await Promise.all([
          insertSupabaseWorkOrderTimeline(
            sb,
            wo2.id,
            req.adminUser.fullName,
            decision === "approve" ? "qc_approved" : "qc_rejected",
            `QC ${decision === "approve" ? "Approved (QC Verified)" : "Rejected"}${qcNotes ? `: ${qcNotes}` : "."}`
          ),
          decision === "reject" ? insertSupabaseNotification(sb, {
            eventType: "qc_rejected",
            title: `QC Rejected: ${wo2.workOrderCode}`,
            message: qcNotes || "Corrections required on work order.",
            entityType: "work_order",
            entityId: wo2.id
          }) : Promise.resolve(),
          insertSupabaseAuditLog(sb, {
            actorId: req.adminUser.id,
            actorEmail: req.adminUser.email,
            actorRole: req.adminUser.role,
            action: `work_order_qc_${decision}`,
            entityType: "work_order",
            entityId: wo2.id,
            summary: `QC ${decision} on ${wo2.workOrderCode}.`
          })
        ]);
        res.json({ item: wo2 });
        return;
      }
      const db = getDbState();
      const wo = db.workOrders.find((w) => w.id === req.params.id);
      if (!wo) {
        res.status(404).json({ error: "Work order not found." });
        return;
      }
      wo.status = decision === "approve" ? "QC Verified" : "QC Rejected";
      wo.qcNotes = qcNotes;
      if (decision === "approve") {
        wo.completionDate = wo.completionDate || (/* @__PURE__ */ new Date()).toISOString();
      }
      wo.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      appendWorkOrderTimeline(
        db,
        wo.id,
        req.adminUser.fullName,
        decision === "approve" ? "qc_approved" : "qc_rejected",
        `QC ${decision === "approve" ? "Approved (QC Verified)" : "Rejected"}${qcNotes ? `: ${qcNotes}` : "."}`
      );
      if (decision === "reject") {
        appendNotification(db, {
          eventType: "qc_rejected",
          title: `QC Rejected: ${wo.workOrderCode}`,
          message: qcNotes || "Corrections required on work order.",
          entityType: "work_order",
          entityId: wo.id
        });
      }
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: `work_order_qc_${decision}`,
        entityType: "work_order",
        entityId: wo.id,
        summary: `QC ${decision} on ${wo.workOrderCode}.`
      });
      saveDbState(db);
      res.json({ item: wo });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/work-orders/:id/notes", requireAdmin, requirePermission("work_orders.write"), async (req, res, next) => {
    try {
      const body = sanitizeText(req.body?.body, 2500);
      const isInternal = req.body?.isInternal !== false;
      if (!body) {
        res.status(400).json({ error: "Note text is required." });
        return;
      }
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const { data: wo2 } = await sb.from("work_orders").select("id").eq("id", req.params.id).maybeSingle();
        if (!wo2) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const { data: noteRow, error: noteErr } = await sb.from("work_order_notes").insert({
          work_order_id: wo2.id,
          author_id: req.adminUser.id,
          author_name: req.adminUser.fullName,
          is_internal: isInternal,
          body
        }).select("*").single();
        if (noteErr || !noteRow) {
          res.status(500).json({ error: noteErr?.message || "Unable to save note." });
          return;
        }
        await insertSupabaseWorkOrderTimeline(
          sb,
          wo2.id,
          req.adminUser.fullName,
          "note_added",
          `Added ${isInternal ? "internal" : "client-visible"} note.`
        );
        res.status(201).json({ item: mapWorkOrderNoteRow(noteRow) });
        return;
      }
      const db = getDbState();
      const wo = db.workOrders.find((w) => w.id === req.params.id);
      if (!wo) {
        res.status(404).json({ error: "Work order not found." });
        return;
      }
      const note = {
        id: crypto7.randomUUID(),
        workOrderId: wo.id,
        authorName: req.adminUser.fullName,
        isInternal,
        body,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      db.workOrderNotes.unshift(note);
      appendWorkOrderTimeline(
        db,
        wo.id,
        req.adminUser.fullName,
        "note_added",
        `Added ${isInternal ? "internal" : "client-visible"} note.`
      );
      saveDbState(db);
      res.status(201).json({ item: note });
    } catch (err) {
      next(err);
    }
  });
  router.post(
    "/admin/work-orders/:id/attachments",
    requireAdmin,
    requirePermission("work_orders.write"),
    uploadAttachmentMiddleware.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "File is required." });
          return;
        }
        const kindRaw = sanitizeText(req.body?.kind, 30);
        const kind = ["document", "before_photo", "after_photo"].includes(kindRaw) ? kindRaw : "document";
        const fileName = sanitizeText(req.file.originalname, 180);
        const sb = getSupabaseAdminClient();
        if (sb) {
          if (!isUuid(req.params.id)) {
            res.status(404).json({ error: "Work order not found." });
            return;
          }
          const { data: wo2 } = await sb.from("work_orders").select("id").eq("id", req.params.id).maybeSingle();
          if (!wo2) {
            res.status(404).json({ error: "Work order not found." });
            return;
          }
          const { storagePath: storagePath2 } = await persistUploadedFile("work-order-attachments", req.file);
          const { data: attRow, error: attErr } = await sb.from("work_order_attachments").insert({
            work_order_id: wo2.id,
            kind,
            file_name: fileName,
            storage_bucket: "work-order-attachments",
            storage_path: storagePath2,
            mime_type: req.file.mimetype,
            file_size: req.file.size,
            uploaded_by: req.adminUser.id
          }).select("*").single();
          if (attErr || !attRow) {
            res.status(500).json({ error: attErr?.message || "Unable to record attachment." });
            return;
          }
          await insertSupabaseWorkOrderTimeline(
            sb,
            wo2.id,
            req.adminUser.fullName,
            "attachment_uploaded",
            `Uploaded ${kind.replace("_", " ")}: ${fileName}.`
          );
          const profileNames = /* @__PURE__ */ new Map([[req.adminUser.id, req.adminUser.fullName]]);
          res.status(201).json({
            item: mapWorkOrderAttachmentRow(attRow, profileNames)
          });
          return;
        }
        const db = getDbState();
        const wo = db.workOrders.find((w) => w.id === req.params.id);
        if (!wo) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const { storagePath } = await persistUploadedFile("work-order-attachments", req.file);
        const attachment = {
          id: crypto7.randomUUID(),
          workOrderId: wo.id,
          kind,
          fileName,
          storageBucket: "work-order-attachments",
          storagePath,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          uploadedBy: req.adminUser.fullName,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        db.workOrderAttachments.unshift(attachment);
        appendWorkOrderTimeline(
          db,
          wo.id,
          req.adminUser.fullName,
          "attachment_uploaded",
          `Uploaded ${kind.replace("_", " ")}: ${attachment.fileName}.`
        );
        saveDbState(db);
        res.status(201).json({ item: attachment });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
      }
    }
  );
  router.delete("/admin/work-orders/:id", requireAdmin, requirePermission("work_orders.delete"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const { data: existing } = await sb.from("work_orders").select("id, work_order_code").eq("id", req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: "Work order not found." });
          return;
        }
        const { error: delErr } = await sb.from("work_orders").delete().eq("id", req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "work_order_deleted",
          entityType: "work_order",
          entityId: existing.id,
          summary: `Permanently deleted work order ${existing.work_order_code}.`
        });
        res.json({ ok: true });
        return;
      }
      const db = getDbState();
      const idx = db.workOrders.findIndex((w) => w.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: "Work order not found." });
        return;
      }
      const [removed] = db.workOrders.splice(idx, 1);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "work_order_deleted",
        entityType: "work_order",
        entityId: removed.id,
        summary: `Permanently deleted work order ${removed.workOrderCode}.`
      });
      saveDbState(db);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/vendors", requireAdmin, requirePermission("vendors.read"), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 40);
      const q = sanitizeText(req.query.q, 120).toLowerCase();
      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const { data, error } = await sb.from("vendors").select("*").order("registration_date", { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        allItems = (data ?? []).map((r) => mapVendorRow(r));
      } else {
        allItems = getDbState().vendors;
      }
      const items = allItems.filter((v) => {
        if (status && status !== "All" && v.applicationStatus !== status) return false;
        if (q) {
          const hay = `${v.vendorCode} ${v.companyName} ${v.contactPerson} ${v.email} ${v.coverageAreas} ${v.aspenGroveAbc}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/vendors", requireAdmin, requirePermission("vendors.write"), async (req, res, next) => {
    try {
      const companyName = sanitizeText(req.body?.companyName, 140);
      const contactPerson = sanitizeText(req.body?.contactPerson, 120);
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const phone = sanitizeText(req.body?.phone, 40);
      if (!companyName || !contactPerson || !isValidEmail(email) || !phone) {
        res.status(400).json({ error: "Company name, contact person, valid email, and phone are required." });
        return;
      }
      const vendorCode = `VND-${Math.floor(1e4 + Math.random() * 89999)}`;
      const appStatus = VENDOR_APPLICATION_STATUSES.includes(req.body?.applicationStatus) ? req.body.applicationStatus : "Approved";
      const accountStatus = appStatus === "Approved" ? "active" : appStatus === "Suspended" ? "suspended" : "pending";
      const serviceCategories = Array.isArray(req.body?.serviceCategories) ? req.body.serviceCategories.map((s) => sanitizeText(s, 80)).filter(Boolean) : [];
      const counties = Array.isArray(req.body?.counties) ? req.body.counties.map((c) => sanitizeText(c, 80)).filter(Boolean) : [];
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error: insErr } = await sb.from("vendors").insert({
          vendor_code: vendorCode,
          company_name: companyName,
          contact_person: contactPerson,
          email,
          phone,
          address: sanitizeText(req.body?.address, 200),
          city: sanitizeText(req.body?.city, 80),
          state: sanitizeText(req.body?.state, 40),
          zip_code: sanitizeText(req.body?.zipCode, 20),
          service_categories: serviceCategories,
          coverage_areas: sanitizeText(req.body?.coverageAreas, 200),
          counties,
          license_info: sanitizeText(req.body?.licenseInfo, 160),
          insurance_info: sanitizeText(req.body?.insuranceInfo, 160),
          aspen_grove_abc: sanitizeText(req.body?.aspenGroveAbc, 60),
          application_status: appStatus,
          account_status: accountStatus,
          completed_work_orders: 0,
          notes: sanitizeText(req.body?.notes, 2e3),
          is_demo: false
        }).select("*").single();
        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || "Unable to create vendor." });
          return;
        }
        const vendor2 = mapVendorRow(inserted);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "vendor_created",
          entityType: "vendor",
          entityId: vendor2.id,
          summary: `Created vendor ${vendor2.companyName} (${vendor2.vendorCode}).`
        });
        res.status(201).json({ item: vendor2 });
        return;
      }
      const db = getDbState();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const vendor = {
        id: crypto7.randomUUID(),
        vendorCode,
        companyName,
        contactPerson,
        email,
        phone,
        address: sanitizeText(req.body?.address, 200),
        city: sanitizeText(req.body?.city, 80),
        state: sanitizeText(req.body?.state, 40),
        zipCode: sanitizeText(req.body?.zipCode, 20),
        serviceCategories,
        coverageAreas: sanitizeText(req.body?.coverageAreas, 200),
        counties,
        licenseInfo: sanitizeText(req.body?.licenseInfo, 160),
        insuranceInfo: sanitizeText(req.body?.insuranceInfo, 160),
        aspenGroveAbc: sanitizeText(req.body?.aspenGroveAbc, 60),
        applicationStatus: appStatus,
        accountStatus,
        rating: null,
        completedWorkOrders: 0,
        notes: sanitizeText(req.body?.notes, 2e3),
        isDemo: false,
        registrationDate: now,
        updatedAt: now
      };
      db.vendors.unshift(vendor);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "vendor_created",
        entityType: "vendor",
        entityId: vendor.id,
        summary: `Created vendor ${vendor.companyName} (${vendor.vendorCode}).`
      });
      saveDbState(db);
      res.status(201).json({ item: vendor });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/vendors/:id", requireAdmin, requirePermission("vendors.read"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const param = req.params.id;
        let query = sb.from("vendors").select("*");
        query = isUuid(param) ? query.eq("id", param) : query.eq("vendor_code", param);
        const { data: vendorRow, error: vErr } = await query.maybeSingle();
        if (vErr) {
          res.status(500).json({ error: vErr.message });
          return;
        }
        if (!vendorRow) {
          res.status(404).json({ error: "Vendor not found." });
          return;
        }
        const vendor2 = mapVendorRow(vendorRow);
        const vendorNames = /* @__PURE__ */ new Map([[vendor2.id, vendor2.companyName]]);
        const [woRes, bidRes, docRes, actRes, woCodeMap] = await Promise.all([
          sb.from("work_orders").select("*").eq("assigned_vendor_id", vendor2.id).order("created_at", { ascending: false }),
          sb.from("vendor_bids").select("*").eq("vendor_id", vendor2.id).order("submitted_at", { ascending: false }),
          sb.from("vendor_documents").select("*").eq("vendor_id", vendor2.id).order("created_at", { ascending: false }),
          sb.from("admin_activity_logs").select("*").eq("entity_type", "vendor").eq("entity_id", vendor2.id).order("created_at", { ascending: false }),
          getWorkOrderCodeMap(sb)
        ]);
        res.json({
          item: vendor2,
          workOrders: (woRes.data ?? []).map((r) => mapWorkOrderRow(r, vendorNames)),
          bids: (bidRes.data ?? []).map((r) => mapVendorBidRow(r, woCodeMap)),
          documents: (docRes.data ?? []).map((r) => mapVendorDocRow(r)),
          activity: (actRes.data ?? []).map((r) => mapActivityLogRow(r))
        });
        return;
      }
      const db = getDbState();
      const vendor = db.vendors.find((v) => v.id === req.params.id || v.vendorCode === req.params.id);
      if (!vendor) {
        res.status(404).json({ error: "Vendor not found." });
        return;
      }
      const workOrders = db.workOrders.filter((w) => w.assignedVendorId === vendor.id);
      const bids = db.vendorBids.filter((b) => b.vendorId === vendor.id || b.vendorName === vendor.companyName);
      const documents = db.vendorDocuments.filter((d) => d.vendorId === vendor.id);
      const activity = db.activityLogs.filter((l) => l.entityType === "vendor" && l.entityId === vendor.id);
      res.json({ item: vendor, workOrders, bids, documents, activity });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/vendors/:id", requireAdmin, requirePermission("vendors.write"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Vendor not found." });
          return;
        }
        const updates = {};
        if (req.body?.companyName !== void 0) updates.company_name = sanitizeText(req.body.companyName, 140);
        if (req.body?.contactPerson !== void 0) updates.contact_person = sanitizeText(req.body.contactPerson, 120);
        if (req.body?.email !== void 0 && isValidEmail(req.body.email)) updates.email = sanitizeText(req.body.email, 254).toLowerCase();
        if (req.body?.phone !== void 0) updates.phone = sanitizeText(req.body.phone, 40);
        if (req.body?.address !== void 0) updates.address = sanitizeText(req.body.address, 200);
        if (req.body?.city !== void 0) updates.city = sanitizeText(req.body.city, 80);
        if (req.body?.state !== void 0) updates.state = sanitizeText(req.body.state, 40);
        if (req.body?.zipCode !== void 0) updates.zip_code = sanitizeText(req.body.zipCode, 20);
        if (Array.isArray(req.body?.serviceCategories)) {
          updates.service_categories = req.body.serviceCategories.map((s) => sanitizeText(s, 80)).filter(Boolean);
        }
        if (req.body?.coverageAreas !== void 0) updates.coverage_areas = sanitizeText(req.body.coverageAreas, 200);
        if (Array.isArray(req.body?.counties)) {
          updates.counties = req.body.counties.map((c) => sanitizeText(c, 80)).filter(Boolean);
        }
        if (req.body?.licenseInfo !== void 0) updates.license_info = sanitizeText(req.body.licenseInfo, 160);
        if (req.body?.insuranceInfo !== void 0) updates.insurance_info = sanitizeText(req.body.insuranceInfo, 160);
        if (req.body?.aspenGroveAbc !== void 0) updates.aspen_grove_abc = sanitizeText(req.body.aspenGroveAbc, 60);
        if (req.body?.notes !== void 0) updates.notes = sanitizeText(req.body.notes, 2e3);
        const { data: updated, error: updErr } = await sb.from("vendors").update(updates).eq("id", req.params.id).select("*").maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Vendor not found." });
          return;
        }
        const vendor2 = mapVendorRow(updated);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "vendor_updated",
          entityType: "vendor",
          entityId: vendor2.id,
          summary: `Updated profile for vendor ${vendor2.companyName}.`
        });
        res.json({ item: vendor2 });
        return;
      }
      const db = getDbState();
      const vendor = db.vendors.find((v) => v.id === req.params.id);
      if (!vendor) {
        res.status(404).json({ error: "Vendor not found." });
        return;
      }
      if (req.body?.companyName !== void 0) vendor.companyName = sanitizeText(req.body.companyName, 140);
      if (req.body?.contactPerson !== void 0) vendor.contactPerson = sanitizeText(req.body.contactPerson, 120);
      if (req.body?.email !== void 0 && isValidEmail(req.body.email)) vendor.email = sanitizeText(req.body.email, 254).toLowerCase();
      if (req.body?.phone !== void 0) vendor.phone = sanitizeText(req.body.phone, 40);
      if (req.body?.address !== void 0) vendor.address = sanitizeText(req.body.address, 200);
      if (req.body?.city !== void 0) vendor.city = sanitizeText(req.body.city, 80);
      if (req.body?.state !== void 0) vendor.state = sanitizeText(req.body.state, 40);
      if (req.body?.zipCode !== void 0) vendor.zipCode = sanitizeText(req.body.zipCode, 20);
      if (Array.isArray(req.body?.serviceCategories)) {
        vendor.serviceCategories = req.body.serviceCategories.map((s) => sanitizeText(s, 80)).filter(Boolean);
      }
      if (req.body?.coverageAreas !== void 0) vendor.coverageAreas = sanitizeText(req.body.coverageAreas, 200);
      if (Array.isArray(req.body?.counties)) {
        vendor.counties = req.body.counties.map((c) => sanitizeText(c, 80)).filter(Boolean);
      }
      if (req.body?.licenseInfo !== void 0) vendor.licenseInfo = sanitizeText(req.body.licenseInfo, 160);
      if (req.body?.insuranceInfo !== void 0) vendor.insuranceInfo = sanitizeText(req.body.insuranceInfo, 160);
      if (req.body?.aspenGroveAbc !== void 0) vendor.aspenGroveAbc = sanitizeText(req.body.aspenGroveAbc, 60);
      if (req.body?.notes !== void 0) vendor.notes = sanitizeText(req.body.notes, 2e3);
      vendor.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "vendor_updated",
        entityType: "vendor",
        entityId: vendor.id,
        summary: `Updated profile for vendor ${vendor.companyName}.`
      });
      saveDbState(db);
      res.json({ item: vendor });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/vendors/:id/status", requireAdmin, requirePermission("vendors.approve"), async (req, res, next) => {
    try {
      const status = sanitizeText(req.body?.applicationStatus, 40);
      if (!VENDOR_APPLICATION_STATUSES.includes(status)) {
        res.status(400).json({ error: "Invalid vendor status." });
        return;
      }
      const nextAccountStatus = status === "Approved" ? "active" : status === "Suspended" || status === "Rejected" ? "suspended" : "pending";
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Vendor not found." });
          return;
        }
        const { data: updated, error: updErr } = await sb.from("vendors").update({ application_status: status, account_status: nextAccountStatus }).eq("id", req.params.id).select("*").maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Vendor not found." });
          return;
        }
        const vendor2 = mapVendorRow(updated);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "vendor_status_changed",
          entityType: "vendor",
          entityId: vendor2.id,
          summary: `Set vendor ${vendor2.companyName} status to ${status}.`
        });
        res.json({ item: vendor2 });
        return;
      }
      const db = getDbState();
      const vendor = db.vendors.find((v) => v.id === req.params.id);
      if (!vendor) {
        res.status(404).json({ error: "Vendor not found." });
        return;
      }
      vendor.applicationStatus = status;
      vendor.accountStatus = nextAccountStatus;
      vendor.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "vendor_status_changed",
        entityType: "vendor",
        entityId: vendor.id,
        summary: `Set vendor ${vendor.companyName} status to ${status}.`
      });
      saveDbState(db);
      res.json({ item: vendor });
    } catch (err) {
      next(err);
    }
  });
  router.post(
    "/admin/vendors/:id/documents",
    requireAdmin,
    requirePermission("vendors.write"),
    uploadAttachmentMiddleware.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "Document file is required." });
          return;
        }
        const docType = sanitizeText(req.body?.docType, 80) || "Compliance Document";
        const fileName = sanitizeText(req.file.originalname, 180);
        const expiresAt = sanitizeText(req.body?.expiresAt, 30) || null;
        const sb = getSupabaseAdminClient();
        if (sb) {
          if (!isUuid(req.params.id)) {
            res.status(404).json({ error: "Vendor not found." });
            return;
          }
          const { data: vendor2 } = await sb.from("vendors").select("id, company_name").eq("id", req.params.id).maybeSingle();
          if (!vendor2) {
            res.status(404).json({ error: "Vendor not found." });
            return;
          }
          const { storagePath: storagePath2 } = await persistUploadedFile("vendor-documents", req.file);
          const { data: docRow, error: docErr } = await sb.from("vendor_documents").insert({
            vendor_id: vendor2.id,
            doc_type: docType,
            file_name: fileName,
            storage_bucket: "vendor-documents",
            storage_path: storagePath2,
            mime_type: req.file.mimetype,
            file_size: req.file.size,
            verified: true,
            expires_at: expiresAt
          }).select("*").single();
          if (docErr || !docRow) {
            res.status(500).json({ error: docErr?.message || "Failed to save vendor document." });
            return;
          }
          await insertSupabaseAuditLog(sb, {
            actorId: req.adminUser.id,
            actorEmail: req.adminUser.email,
            actorRole: req.adminUser.role,
            action: "vendor_document_uploaded",
            entityType: "vendor",
            entityId: vendor2.id,
            summary: `Uploaded ${docType} (${fileName}) for ${vendor2.company_name}.`
          });
          res.status(201).json({ item: mapVendorDocRow(docRow) });
          return;
        }
        const db = getDbState();
        const vendor = db.vendors.find((v) => v.id === req.params.id);
        if (!vendor) {
          res.status(404).json({ error: "Vendor not found." });
          return;
        }
        const { storagePath } = await persistUploadedFile("vendor-documents", req.file);
        const doc = {
          id: crypto7.randomUUID(),
          vendorId: vendor.id,
          docType,
          fileName,
          storageBucket: "vendor-documents",
          storagePath,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          verified: true,
          expiresAt,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        db.vendorDocuments.unshift(doc);
        appendActivityLog(db, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "vendor_document_uploaded",
          entityType: "vendor",
          entityId: vendor.id,
          summary: `Uploaded ${doc.docType} (${doc.fileName}) for ${vendor.companyName}.`
        });
        saveDbState(db);
        res.status(201).json({ item: doc });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
      }
    }
  );
  router.get("/admin/clients", requireAdmin, requirePermission("clients.read"), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 30);
      const clientType = sanitizeText(req.query.clientType, 60);
      const q = sanitizeText(req.query.q, 120).toLowerCase();
      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const { data, error } = await sb.from("clients").select("*").order("created_at", { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        allItems = (data ?? []).map((r) => mapClientRow(r));
      } else {
        allItems = getDbState().clients;
      }
      const items = allItems.filter((c) => {
        if (status && status !== "All" && c.accountStatus !== status) return false;
        if (clientType && clientType !== "All" && c.clientType !== clientType) return false;
        if (q) {
          const hay = `${c.clientCode} ${c.companyName} ${c.contactName} ${c.email} ${c.phone}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/clients", requireAdmin, requirePermission("clients.write"), async (req, res, next) => {
    try {
      const contactName = sanitizeText(req.body?.contactName, 120);
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const phone = sanitizeText(req.body?.phone, 40);
      const clientType = sanitizeText(req.body?.clientType, 60);
      if (!contactName || !isValidEmail(email) || !phone) {
        res.status(400).json({ error: "Contact name, valid email, and phone are required." });
        return;
      }
      const clientCode = `CLI-${Math.floor(1100 + Math.random() * 8800)}`;
      const resolvedClientType = CLIENT_TYPES.includes(clientType) ? clientType : "Property Manager";
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error: insErr } = await sb.from("clients").insert({
          client_code: clientCode,
          company_name: sanitizeText(req.body?.companyName, 140),
          contact_name: contactName,
          email,
          phone,
          client_type: resolvedClientType,
          address: sanitizeText(req.body?.address, 240),
          notes: sanitizeText(req.body?.notes, 2e3),
          account_status: "active",
          is_demo: false
        }).select("*").single();
        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || "Unable to create client." });
          return;
        }
        const client2 = mapClientRow(inserted);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "client_created",
          entityType: "client",
          entityId: client2.id,
          summary: `Created client ${client2.companyName || client2.contactName} (${client2.clientCode}).`
        });
        res.status(201).json({ item: client2 });
        return;
      }
      const db = getDbState();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const client = {
        id: crypto7.randomUUID(),
        clientCode,
        companyName: sanitizeText(req.body?.companyName, 140),
        contactName,
        email,
        phone,
        clientType: resolvedClientType,
        address: sanitizeText(req.body?.address, 240),
        notes: sanitizeText(req.body?.notes, 2e3),
        accountStatus: "active",
        isDemo: false,
        createdAt: now,
        updatedAt: now
      };
      db.clients.unshift(client);
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "client_created",
        entityType: "client",
        entityId: client.id,
        summary: `Created client ${client.companyName || client.contactName} (${client.clientCode}).`
      });
      saveDbState(db);
      res.status(201).json({ item: client });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/clients/:id", requireAdmin, requirePermission("clients.read"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const param = req.params.id;
        let query = sb.from("clients").select("*");
        query = isUuid(param) ? query.eq("id", param) : query.eq("client_code", param);
        const { data: clientRow, error: cliErr } = await query.maybeSingle();
        if (cliErr) {
          res.status(500).json({ error: cliErr.message });
          return;
        }
        if (!clientRow) {
          res.status(404).json({ error: "Client not found." });
          return;
        }
        const client2 = mapClientRow(clientRow);
        const [woRes, bidRes, msgRes, propRes, vendorNames] = await Promise.all([
          sb.from("work_orders").select("*").eq("client_id", client2.id).order("created_at", { ascending: false }),
          sb.from("bid_requests").select("*").ilike("email", client2.email).order("created_at", { ascending: false }),
          sb.from("messages").select("*").or(`linked_client_id.eq.${client2.id},sender_email.ilike.${client2.email}`).order("created_at", { ascending: false }),
          sb.from("client_properties").select("*").eq("client_id", client2.id).order("created_at", { ascending: false }),
          getVendorNameMap(sb)
        ]);
        res.json({
          item: client2,
          workOrders: (woRes.data ?? []).map((r) => mapWorkOrderRow(r, vendorNames)),
          bidRequests: (bidRes.data ?? []).map((r) => mapBidRequestRow(r)),
          messages: (msgRes.data ?? []).map((r) => mapMessageRow(r)),
          properties: (propRes.data ?? []).map((r) => mapClientPropertyRow(r))
        });
        return;
      }
      const db = getDbState();
      const client = db.clients.find((c) => c.id === req.params.id || c.clientCode === req.params.id);
      if (!client) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      const workOrders = db.workOrders.filter((w) => w.clientId === client.id);
      const bidRequests = db.bidRequests.filter((b) => b.email.toLowerCase() === client.email.toLowerCase());
      const messages = db.messages.filter(
        (m) => m.linkedClientId === client.id || m.senderEmail.toLowerCase() === client.email.toLowerCase()
      );
      const properties = db.clientProperties.filter((p) => p.clientId === client.id);
      res.json({ item: client, workOrders, bidRequests, messages, properties });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/clients/:id", requireAdmin, requirePermission("clients.write"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Client not found." });
          return;
        }
        const updates = {};
        if (req.body?.companyName !== void 0) updates.company_name = sanitizeText(req.body.companyName, 140);
        if (req.body?.contactName !== void 0) updates.contact_name = sanitizeText(req.body.contactName, 120);
        if (req.body?.email && isValidEmail(req.body.email)) updates.email = sanitizeText(req.body.email, 254).toLowerCase();
        if (req.body?.phone !== void 0) updates.phone = sanitizeText(req.body.phone, 40);
        if (req.body?.clientType && CLIENT_TYPES.includes(req.body.clientType)) updates.client_type = req.body.clientType;
        if (req.body?.address !== void 0) updates.address = sanitizeText(req.body.address, 240);
        if (req.body?.notes !== void 0) updates.notes = sanitizeText(req.body.notes, 2e3);
        if (req.body?.accountStatus && ["active", "archived"].includes(req.body.accountStatus)) {
          updates.account_status = req.body.accountStatus;
        }
        const { data: updated, error: updErr } = await sb.from("clients").update(updates).eq("id", req.params.id).select("*").maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Client not found." });
          return;
        }
        const client2 = mapClientRow(updated);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "client_updated",
          entityType: "client",
          entityId: client2.id,
          summary: `Updated client ${client2.companyName || client2.contactName} (${client2.accountStatus}).`
        });
        res.json({ item: client2 });
        return;
      }
      const db = getDbState();
      const client = db.clients.find((c) => c.id === req.params.id);
      if (!client) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      if (req.body?.companyName !== void 0) client.companyName = sanitizeText(req.body.companyName, 140);
      if (req.body?.contactName !== void 0) client.contactName = sanitizeText(req.body.contactName, 120);
      if (req.body?.email && isValidEmail(req.body.email)) client.email = sanitizeText(req.body.email, 254).toLowerCase();
      if (req.body?.phone !== void 0) client.phone = sanitizeText(req.body.phone, 40);
      if (req.body?.clientType && CLIENT_TYPES.includes(req.body.clientType)) client.clientType = req.body.clientType;
      if (req.body?.address !== void 0) client.address = sanitizeText(req.body.address, 240);
      if (req.body?.notes !== void 0) client.notes = sanitizeText(req.body.notes, 2e3);
      if (req.body?.accountStatus && ["active", "archived"].includes(req.body.accountStatus)) {
        client.accountStatus = req.body.accountStatus;
      }
      client.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "client_updated",
        entityType: "client",
        entityId: client.id,
        summary: `Updated client ${client.companyName || client.contactName} (${client.accountStatus}).`
      });
      saveDbState(db);
      res.json({ item: client });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/clients/:id/properties", requireAdmin, requirePermission("clients.write"), async (req, res, next) => {
    try {
      const address = sanitizeText(req.body?.address, 240);
      if (!address) {
        res.status(400).json({ error: "Property address is required." });
        return;
      }
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Client not found." });
          return;
        }
        const { data: client2 } = await sb.from("clients").select("id").eq("id", req.params.id).maybeSingle();
        if (!client2) {
          res.status(404).json({ error: "Client not found." });
          return;
        }
        const { data: propRow, error: propErr } = await sb.from("client_properties").insert({
          client_id: client2.id,
          address,
          city: sanitizeText(req.body?.city, 80),
          state: sanitizeText(req.body?.state, 40),
          zip_code: sanitizeText(req.body?.zipCode, 20),
          county: sanitizeText(req.body?.county, 80),
          lat: req.body?.lat != null && req.body.lat !== "" ? Number(req.body.lat) : null,
          lng: req.body?.lng != null && req.body.lng !== "" ? Number(req.body.lng) : null,
          occupancy_status: sanitizeText(req.body?.occupancyStatus, 40) || "Vacant",
          lockbox_code: sanitizeText(req.body?.lockboxCode, 40),
          notes: sanitizeText(req.body?.notes, 500)
        }).select("*").single();
        if (propErr || !propRow) {
          res.status(500).json({ error: propErr?.message || "Unable to save property." });
          return;
        }
        res.status(201).json({ item: mapClientPropertyRow(propRow) });
        return;
      }
      const db = getDbState();
      const client = db.clients.find((c) => c.id === req.params.id);
      if (!client) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      const prop = {
        id: crypto7.randomUUID(),
        clientId: client.id,
        address,
        city: sanitizeText(req.body?.city, 80),
        state: sanitizeText(req.body?.state, 40),
        zipCode: sanitizeText(req.body?.zipCode, 20),
        county: sanitizeText(req.body?.county, 80),
        lat: req.body?.lat != null && req.body.lat !== "" ? Number(req.body.lat) : null,
        lng: req.body?.lng != null && req.body.lng !== "" ? Number(req.body.lng) : null,
        occupancyStatus: sanitizeText(req.body?.occupancyStatus, 40) || "Vacant",
        lockboxCode: sanitizeText(req.body?.lockboxCode, 40),
        notes: sanitizeText(req.body?.notes, 500),
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      db.clientProperties.unshift(prop);
      saveDbState(db);
      res.status(201).json({ item: prop });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/bid-requests", requireAdmin, requirePermission("bid_requests.read"), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 40);
      const q = sanitizeText(req.query.q, 120).toLowerCase();
      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const { data, error } = await sb.from("bid_requests").select("*").order("created_at", { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        allItems = (data ?? []).map((r) => mapBidRequestRow(r));
      } else {
        allItems = getDbState().bidRequests;
      }
      const items = allItems.filter((b) => {
        if (status && status !== "All" && b.status !== status) return false;
        if (q) {
          const hay = `${b.requestCode} ${b.contactName} ${b.email} ${b.propertyAddress} ${b.requestedServices}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/bid-requests/:id", requireAdmin, requirePermission("bid_requests.read"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const param = req.params.id;
        let query = sb.from("bid_requests").select("*");
        query = isUuid(param) ? query.eq("id", param) : query.eq("request_code", param);
        const { data: row, error } = await query.maybeSingle();
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        if (!row) {
          res.status(404).json({ error: "Bid request not found." });
          return;
        }
        const item2 = mapBidRequestRow(row);
        const { data: actRows } = await sb.from("admin_activity_logs").select("*").eq("entity_type", "bid_request").eq("entity_id", item2.id).order("created_at", { ascending: false });
        res.json({
          item: item2,
          activity: (actRows ?? []).map((r) => mapActivityLogRow(r))
        });
        return;
      }
      const db = getDbState();
      const item = db.bidRequests.find((b) => b.id === req.params.id || b.requestCode === req.params.id);
      if (!item) {
        res.status(404).json({ error: "Bid request not found." });
        return;
      }
      const activity = db.activityLogs.filter((l) => l.entityType === "bid_request" && l.entityId === item.id);
      res.json({ item, activity });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/bid-requests/:id", requireAdmin, requirePermission("bid_requests.write"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Bid request not found." });
          return;
        }
        const updates = {};
        if (req.body?.status && BID_REQUEST_STATUSES.includes(req.body.status)) {
          updates.status = req.body.status;
          if (req.body.status === "Archived") updates.is_archived = true;
        }
        if (req.body?.internalNotes !== void 0) updates.internal_notes = sanitizeText(req.body.internalNotes, 2e3);
        if (req.body?.isArchived !== void 0) updates.is_archived = Boolean(req.body.isArchived);
        const { data: updated, error: updErr } = await sb.from("bid_requests").update(updates).eq("id", req.params.id).select("*").maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Bid request not found." });
          return;
        }
        const item2 = mapBidRequestRow(updated);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "bid_request_updated",
          entityType: "bid_request",
          entityId: item2.id,
          summary: `Updated bid request ${item2.requestCode} status to ${item2.status}.`
        });
        res.json({ item: item2 });
        return;
      }
      const db = getDbState();
      const item = db.bidRequests.find((b) => b.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: "Bid request not found." });
        return;
      }
      if (req.body?.status && BID_REQUEST_STATUSES.includes(req.body.status)) {
        item.status = req.body.status;
        if (req.body.status === "Archived") item.isArchived = true;
      }
      if (req.body?.internalNotes !== void 0) item.internalNotes = sanitizeText(req.body.internalNotes, 2e3);
      if (req.body?.isArchived !== void 0) item.isArchived = Boolean(req.body.isArchived);
      item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "bid_request_updated",
        entityType: "bid_request",
        entityId: item.id,
        summary: `Updated bid request ${item.requestCode} status to ${item.status}.`
      });
      saveDbState(db);
      res.json({ item });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/bid-requests/:id/convert", requireAdmin, requirePermission("bid_requests.convert"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Bid request not found." });
          return;
        }
        const { data: bidRow } = await sb.from("bid_requests").select("*").eq("id", req.params.id).maybeSingle();
        if (!bidRow) {
          res.status(404).json({ error: "Bid request not found." });
          return;
        }
        const bidReq2 = mapBidRequestRow(bidRow);
        if (bidReq2.convertedWorkOrderId) {
          res.status(409).json({ error: "Bid request has already been converted to a Work Order." });
          return;
        }
        const settings = await getSupabaseBusinessSettings(sb);
        const { data: existingClient } = await sb.from("clients").select("*").ilike("email", bidReq2.email).limit(1).maybeSingle();
        let client2;
        if (existingClient) {
          client2 = mapClientRow(existingClient);
        } else {
          const { data: newClientRow, error: cliErr } = await sb.from("clients").insert({
            client_code: `CLI-${Math.floor(1100 + Math.random() * 8800)}`,
            company_name: "",
            contact_name: bidReq2.contactName,
            email: bidReq2.email,
            phone: bidReq2.phone,
            client_type: "Property Manager",
            address: bidReq2.propertyAddress,
            notes: `Created automatically from bid request ${bidReq2.requestCode}.`,
            account_status: "active",
            is_demo: false
          }).select("*").single();
          if (cliErr || !newClientRow) {
            res.status(500).json({ error: cliErr?.message || "Unable to create client record." });
            return;
          }
          client2 = mapClientRow(newClientRow);
        }
        const code2 = `SLC-${(/* @__PURE__ */ new Date()).getFullYear().toString().slice(-2)}-${Math.floor(4200 + Math.random() * 5700)}`;
        const estimatedBudget2 = Number(req.body?.estimatedBudget) || (bidReq2.estimatorData ? Math.round((bidReq2.estimatorData.lowEstimate + bidReq2.estimatorData.highEstimate) / 2) : 350);
        const parts2 = bidReq2.propertyAddress.split(",").map((s) => s.trim());
        const { data: woRow, error: woErr } = await sb.from("work_orders").insert({
          work_order_code: code2,
          client_id: client2.id,
          client_name: client2.companyName || client2.contactName,
          client_type: client2.clientType,
          property_address: parts2[0] || bidReq2.propertyAddress,
          city: bidReq2.city || parts2[1] || "Cleveland",
          state: bidReq2.state || parts2[2]?.slice(0, 2) || "OH",
          zip_code: bidReq2.zipCode || "",
          county: sanitizeText(req.body?.county, 80),
          service_category: bidReq2.requestedServices,
          service_description: bidReq2.notes || bidReq2.requestedServices,
          priority: PRIORITY_LEVELS.includes(req.body?.priority) ? req.body.priority : "Normal",
          estimated_budget: estimatedBudget2,
          sla_deadline: new Date(Date.now() + settings.defaultSlaHours * 3600 * 1e3).toISOString(),
          status: "Open Bid",
          qc_notes: "",
          is_archived: false,
          is_demo: false
        }).select("*").single();
        if (woErr || !woRow) {
          res.status(500).json({ error: woErr?.message || "Unable to create work order." });
          return;
        }
        const wo2 = mapWorkOrderRow(woRow, /* @__PURE__ */ new Map());
        const { data: updatedBidRow, error: updErr } = await sb.from("bid_requests").update({ status: "Converted", converted_work_order_id: wo2.id }).eq("id", bidReq2.id).select("*").single();
        if (updErr || !updatedBidRow) {
          res.status(500).json({ error: updErr?.message || "Unable to update bid request." });
          return;
        }
        await Promise.all([
          insertSupabaseWorkOrderTimeline(
            sb,
            wo2.id,
            req.adminUser.fullName,
            "converted_from_bid",
            `Work order ${code2} converted from customer bid request ${bidReq2.requestCode}.`
          ),
          insertSupabaseAuditLog(sb, {
            actorId: req.adminUser.id,
            actorEmail: req.adminUser.email,
            actorRole: req.adminUser.role,
            action: "bid_request_converted",
            entityType: "bid_request",
            entityId: bidReq2.id,
            summary: `Converted bid request ${bidReq2.requestCode} into Work Order ${code2}.`
          })
        ]);
        res.status(201).json({
          bidRequest: mapBidRequestRow(updatedBidRow),
          workOrder: wo2
        });
        return;
      }
      const db = getDbState();
      const bidReq = db.bidRequests.find((b) => b.id === req.params.id);
      if (!bidReq) {
        res.status(404).json({ error: "Bid request not found." });
        return;
      }
      if (bidReq.convertedWorkOrderId) {
        res.status(409).json({ error: "Bid request has already been converted to a Work Order." });
        return;
      }
      let client = db.clients.find((c) => c.email.toLowerCase() === bidReq.email.toLowerCase());
      const now = (/* @__PURE__ */ new Date()).toISOString();
      if (!client) {
        client = {
          id: crypto7.randomUUID(),
          clientCode: `CLI-${Math.floor(1100 + Math.random() * 8800)}`,
          companyName: "",
          contactName: bidReq.contactName,
          email: bidReq.email,
          phone: bidReq.phone,
          clientType: "Property Manager",
          address: bidReq.propertyAddress,
          notes: `Created automatically from bid request ${bidReq.requestCode}.`,
          accountStatus: "active",
          isDemo: false,
          createdAt: now,
          updatedAt: now
        };
        db.clients.unshift(client);
      }
      const code = `SLC-${(/* @__PURE__ */ new Date()).getFullYear().toString().slice(-2)}-${Math.floor(4200 + Math.random() * 5700)}`;
      const estimatedBudget = Number(req.body?.estimatedBudget) || (bidReq.estimatorData ? Math.round((bidReq.estimatorData.lowEstimate + bidReq.estimatorData.highEstimate) / 2) : 350);
      const woId = crypto7.randomUUID();
      const parts = bidReq.propertyAddress.split(",").map((s) => s.trim());
      const wo = {
        id: woId,
        workOrderCode: code,
        clientId: client.id,
        clientName: client.companyName || client.contactName,
        clientType: client.clientType,
        propertyAddress: parts[0] || bidReq.propertyAddress,
        city: bidReq.city || parts[1] || "Cleveland",
        state: bidReq.state || parts[2]?.slice(0, 2) || "OH",
        zipCode: bidReq.zipCode || "",
        county: sanitizeText(req.body?.county, 80),
        lat: null,
        lng: null,
        serviceCategory: bidReq.requestedServices,
        serviceDescription: bidReq.notes || bidReq.requestedServices,
        priority: PRIORITY_LEVELS.includes(req.body?.priority) ? req.body.priority : "Normal",
        estimatedBudget,
        approvedBudget: null,
        assignedVendorId: null,
        assignedVendorName: "",
        createdDate: now,
        scheduledDate: null,
        slaDeadline: new Date(Date.now() + db.businessSettings.defaultSlaHours * 3600 * 1e3).toISOString(),
        completionDate: null,
        status: "Open Bid",
        qcNotes: "",
        isArchived: false,
        isDemo: false,
        updatedAt: now
      };
      db.workOrders.unshift(wo);
      bidReq.status = "Converted";
      bidReq.convertedWorkOrderId = wo.id;
      bidReq.updatedAt = now;
      appendWorkOrderTimeline(
        db,
        wo.id,
        req.adminUser.fullName,
        "converted_from_bid",
        `Work order ${code} converted from customer bid request ${bidReq.requestCode}.`
      );
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "bid_request_converted",
        entityType: "bid_request",
        entityId: bidReq.id,
        summary: `Converted bid request ${bidReq.requestCode} into Work Order ${code}.`
      });
      saveDbState(db);
      res.status(201).json({ bidRequest: bidReq, workOrder: wo });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/vendor-bids", requireAdmin, requirePermission("vendor_bids.read"), async (req, res, next) => {
    try {
      const workOrderId = sanitizeText(req.query.workOrderId, 80);
      const status = sanitizeText(req.query.status, 40);
      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const [bidRes, woCodeMap] = await Promise.all([
          sb.from("vendor_bids").select("*").order("submitted_at", { ascending: false }),
          getWorkOrderCodeMap(sb)
        ]);
        if (bidRes.error) {
          res.status(500).json({ error: bidRes.error.message });
          return;
        }
        allItems = (bidRes.data ?? []).map((r) => mapVendorBidRow(r, woCodeMap));
      } else {
        allItems = getDbState().vendorBids;
      }
      const items = allItems.filter((b) => {
        if (workOrderId && b.workOrderId !== workOrderId) return false;
        if (status && status !== "All" && b.status !== status) return false;
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });
  router.post("/admin/vendor-bids/:id/decide", requireAdmin, requirePermission("vendor_bids.decide"), async (req, res, next) => {
    try {
      const decision = sanitizeText(req.body?.decision, 30);
      const note = sanitizeText(req.body?.clarificationNote, 1e3);
      if (!["accept", "reject", "clarify"].includes(decision)) {
        res.status(400).json({ error: "Decision must be accept, reject, or clarify." });
        return;
      }
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Vendor bid not found." });
          return;
        }
        const { data: bidRow } = await sb.from("vendor_bids").select("*").eq("id", req.params.id).maybeSingle();
        if (!bidRow) {
          res.status(404).json({ error: "Vendor bid not found." });
          return;
        }
        const updates = {};
        if (decision === "accept") {
          updates.status = "Accepted";
        } else if (decision === "reject") {
          updates.status = "Rejected";
        } else {
          updates.status = "Under Review";
          updates.clarification_note = note;
        }
        const { data: updatedBidRow, error: bidUpdErr } = await sb.from("vendor_bids").update(updates).eq("id", req.params.id).select("*").single();
        if (bidUpdErr || !updatedBidRow) {
          res.status(500).json({ error: bidUpdErr?.message || "Unable to update vendor bid." });
          return;
        }
        if (decision === "accept" && bidRow.work_order_id) {
          await Promise.all([
            sb.from("work_orders").update({
              assigned_vendor_id: bidRow.vendor_id ?? null,
              approved_budget: bidRow.proposed_price,
              status: "Dispatched"
            }).eq("id", bidRow.work_order_id),
            sb.from("vendor_bids").update({ status: "Rejected" }).eq("work_order_id", bidRow.work_order_id).neq("id", bidRow.id).in("status", ["Submitted", "Under Review"]),
            insertSupabaseWorkOrderTimeline(
              sb,
              String(bidRow.work_order_id),
              req.adminUser.fullName,
              "bid_accepted",
              `Accepted bid ${bidRow.bid_code} ($${Number(bidRow.proposed_price)}) from ${bidRow.vendor_name} and dispatched order.`
            )
          ]);
        }
        const woCodeMap = await getWorkOrderCodeMap(sb);
        const bid2 = mapVendorBidRow(updatedBidRow, woCodeMap);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: `vendor_bid_${decision}`,
          entityType: "vendor_bid",
          entityId: bid2.id,
          summary: `Vendor bid ${bid2.bidCode} marked ${bid2.status}.`
        });
        res.json({ item: bid2 });
        return;
      }
      const db = getDbState();
      const bid = db.vendorBids.find((b) => b.id === req.params.id);
      if (!bid) {
        res.status(404).json({ error: "Vendor bid not found." });
        return;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      if (decision === "accept") {
        bid.status = "Accepted";
        const wo = db.workOrders.find((w) => w.id === bid.workOrderId);
        if (wo) {
          wo.assignedVendorId = bid.vendorId;
          wo.assignedVendorName = bid.vendorName;
          wo.approvedBudget = bid.proposedPrice;
          wo.status = "Dispatched";
          wo.updatedAt = now;
          appendWorkOrderTimeline(
            db,
            wo.id,
            req.adminUser.fullName,
            "bid_accepted",
            `Accepted bid ${bid.bidCode} ($${bid.proposedPrice}) from ${bid.vendorName} and dispatched order.`
          );
        }
        for (const other of db.vendorBids) {
          if (other.workOrderId === bid.workOrderId && other.id !== bid.id && (other.status === "Submitted" || other.status === "Under Review")) {
            other.status = "Rejected";
            other.updatedAt = now;
          }
        }
      } else if (decision === "reject") {
        bid.status = "Rejected";
      } else {
        bid.status = "Under Review";
        bid.clarificationNote = note;
      }
      bid.updatedAt = now;
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: `vendor_bid_${decision}`,
        entityType: "vendor_bid",
        entityId: bid.id,
        summary: `Vendor bid ${bid.bidCode} marked ${bid.status}.`
      });
      saveDbState(db);
      res.json({ item: bid });
    } catch (err) {
      next(err);
    }
  });
  router.get("/admin/dispatch", requireAdmin, requirePermission("dispatch.read"), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 40);
      const priority = sanitizeText(req.query.priority, 20);
      const q = sanitizeText(req.query.q, 120).toLowerCase();
      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const [dispRes, vendorNames] = await Promise.all([
          sb.from("dispatch_requests").select("*").order("submitted_at", { ascending: false }),
          getVendorNameMap(sb)
        ]);
        if (dispRes.error) {
          res.status(500).json({ error: dispRes.error.message });
          return;
        }
        allItems = (dispRes.data ?? []).map((r) => mapDispatchRow(r, vendorNames));
      } else {
        allItems = getDbState().dispatchRequests;
      }
      const items = allItems.filter((d) => {
        if (status && status !== "All" && d.status !== status) return false;
        if (priority && priority !== "All" && d.priority !== priority) return false;
        if (q) {
          const hay = `${d.dispatchCode} ${d.contactName} ${d.phone} ${d.propertyAddress} ${d.emergencyType}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });
  router.patch("/admin/dispatch/:id", requireAdmin, requirePermission("dispatch.write"), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: "Dispatch request not found." });
          return;
        }
        const { data: existing } = await sb.from("dispatch_requests").select("*").eq("id", req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: "Dispatch request not found." });
          return;
        }
        const now2 = (/* @__PURE__ */ new Date()).toISOString();
        const prevStatus2 = existing.status;
        let nextStatus = prevStatus2;
        const timeline = Array.isArray(existing.timeline) ? [...existing.timeline] : [];
        const updates = {};
        if (req.body?.status && DISPATCH_STATUSES.includes(req.body.status)) {
          nextStatus = req.body.status;
          updates.status = nextStatus;
        }
        if (req.body?.priority && PRIORITY_LEVELS.includes(req.body.priority)) {
          updates.priority = req.body.priority;
        }
        if (req.body?.internalNotes !== void 0) {
          updates.internal_notes = sanitizeText(req.body.internalNotes, 2e3);
        }
        if (req.body?.assignedVendorId !== void 0) {
          const vid = sanitizeText(req.body.assignedVendorId, 80) || null;
          updates.assigned_vendor_id = vid && isUuid(vid) ? vid : null;
          let vendorName = "";
          if (vid && isUuid(vid)) {
            const { data: v } = await sb.from("vendors").select("company_name").eq("id", vid).maybeSingle();
            vendorName = v?.company_name ?? "";
          }
          if (vendorName && nextStatus === "New") {
            nextStatus = "Assigned";
            updates.status = "Assigned";
          }
          timeline.unshift({
            id: crypto7.randomUUID(),
            actorName: req.adminUser.fullName,
            description: vendorName ? `Assigned emergency dispatch to ${vendorName}.` : "Cleared vendor assignment.",
            createdAt: now2
          });
        }
        if (nextStatus !== prevStatus2) {
          timeline.unshift({
            id: crypto7.randomUUID(),
            actorName: req.adminUser.fullName,
            description: `Status updated from ${prevStatus2} to ${nextStatus}.`,
            createdAt: now2
          });
        }
        updates.timeline = timeline;
        const { data: updated, error: updErr } = await sb.from("dispatch_requests").update(updates).eq("id", req.params.id).select("*").single();
        if (updErr || !updated) {
          res.status(500).json({ error: updErr?.message || "Unable to update dispatch request." });
          return;
        }
        const vendorNames = await getVendorNameMap(sb);
        const item2 = mapDispatchRow(updated, vendorNames);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser.id,
          actorEmail: req.adminUser.email,
          actorRole: req.adminUser.role,
          action: "dispatch_updated",
          entityType: "dispatch",
          entityId: item2.id,
          summary: `Updated dispatch ${item2.dispatchCode} (${item2.status}).`
        });
        res.json({ item: item2 });
        return;
      }
      const db = getDbState();
      const item = db.dispatchRequests.find((d) => d.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: "Dispatch request not found." });
        return;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const prevStatus = item.status;
      if (req.body?.status && DISPATCH_STATUSES.includes(req.body.status)) item.status = req.body.status;
      if (req.body?.priority && PRIORITY_LEVELS.includes(req.body.priority)) item.priority = req.body.priority;
      if (req.body?.internalNotes !== void 0) item.internalNotes = sanitizeText(req.body.internalNotes, 2e3);
      if (req.body?.assignedVendorId !== void 0) {
        const vid = sanitizeText(req.body.assignedVendorId, 80) || null;
        item.assignedVendorId = vid;
        const v = vid ? db.vendors.find((vnd) => vnd.id === vid) : void 0;
        item.assignedVendorName = v ? v.companyName : "";
        if (v && item.status === "New") item.status = "Assigned";
        item.timeline.unshift({
          id: crypto7.randomUUID(),
          actorName: req.adminUser.fullName,
          description: v ? `Assigned emergency dispatch to ${v.companyName}.` : "Cleared vendor assignment.",
          createdAt: now
        });
      }
      if (item.status !== prevStatus) {
        item.timeline.unshift({
          id: crypto7.randomUUID(),
          actorName: req.adminUser.fullName,
          description: `Status updated from ${prevStatus} to ${item.status}.`,
          createdAt: now
        });
      }
      item.updatedAt = now;
      appendActivityLog(db, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: "dispatch_updated",
        entityType: "dispatch",
        entityId: item.id,
        summary: `Updated dispatch ${item.dispatchCode} (${item.status}).`
      });
      saveDbState(db);
      res.json({ item });
    } catch (err) {
      next(err);
    }
  });
}

// server/routes/publicRoutes.ts
import crypto8 from "node:crypto";
function toLocalPublicBootstrap() {
  const state = getDbState();
  return {
    services: state.services.filter((s) => s.isVisible && !s.isArchived).sort((a, b) => a.sortOrder - b.sortOrder),
    galleryCases: state.galleryCases.filter((g) => g.isPublished).sort((a, b) => a.sortOrder - b.sortOrder),
    coverageRegions: state.coverageRegions.filter((r) => r.isPublished),
    reviews: state.reviews.filter((r) => r.publicationStatus === "Published").sort((a, b) => a.sortOrder - b.sortOrder),
    publicWorkOrders: state.workOrders.filter(
      (w) => !w.isArchived && ["Open Bid", "Dispatched", "In Progress", "QC Verified"].includes(w.status)
    ).map((w) => ({
      id: w.id,
      workOrderCode: w.workOrderCode,
      clientType: w.clientType,
      serviceType: w.serviceDescription,
      cityState: `${w.city}, ${w.state}`,
      county: w.county,
      status: w.status,
      slaDue: w.slaDeadline ? `SLA: ${new Date(w.slaDeadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Standard SLA",
      estimatedBudget: w.estimatedBudget,
      coordinates: w.lat != null && w.lng != null ? { lat: w.lat, lng: w.lng } : null
    })),
    businessSettings: state.businessSettings
  };
}
function registerPublicRoutes(router) {
  const publicSubmitLimiter = createRateLimiter(25, 15 * 60 * 1e3);
  router.get("/public/maps-config", (_req, res) => {
    const rawKey = (process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "").trim();
    const apiKey = rawKey && rawKey !== "MY_GOOGLE_MAPS_API_KEY" ? rawKey : "";
    res.json({ apiKey });
  });
  router.get("/public/bootstrap", async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const data = await getPublicBootstrapFromSupabase(sb);
        res.json(data);
        return;
      }
      res.json(toLocalPublicBootstrap());
    } catch (err) {
      next(err);
    }
  });
  router.post("/public/bid-requests", publicSubmitLimiter, async (req, res, next) => {
    try {
      const name = sanitizeText(req.body?.name, 120);
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const phone = sanitizeText(req.body?.phone, 40);
      const propertyAddress = sanitizeText(req.body?.propertyAddress, 240);
      const city = sanitizeText(req.body?.city, 80);
      const stateCode = sanitizeText(req.body?.state, 40);
      const zipCode = sanitizeText(req.body?.zipCode, 20);
      const requestedServices = sanitizeText(req.body?.serviceScope || req.body?.requestedServices, 180) || "Property Preservation";
      const notes = sanitizeText(req.body?.notes, 2e3);
      const est = req.body?.estimatorData;
      if (!name || !isValidEmail(email) || phone.length < 7 || !propertyAddress) {
        res.status(400).json({
          error: "Please provide your name, valid email, phone number, and property address."
        });
        return;
      }
      const estimatorData = est && typeof est === "object" && typeof est.lowEstimate === "number" && typeof est.highEstimate === "number" ? {
        categoryLabel: sanitizeText(est.categoryLabel, 120),
        lowEstimate: Number(est.lowEstimate),
        highEstimate: Number(est.highEstimate),
        summary: sanitizeText(est.summary, 300)
      } : null;
      const requestCode = `EST-${Math.floor(1e5 + Math.random() * 899999)}`;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error } = await sb.from("bid_requests").insert({
          request_code: requestCode,
          contact_name: name,
          email,
          phone,
          property_address: propertyAddress,
          city,
          state: stateCode,
          zip_code: zipCode,
          requested_services: requestedServices,
          notes,
          estimator_data: estimatorData,
          status: "New",
          internal_notes: "",
          is_archived: false
        }).select("id, request_code, created_at").single();
        if (error || !inserted) {
          res.status(500).json({ error: error?.message || "Unable to save bid request." });
          return;
        }
        await insertSupabaseNotification(sb, {
          eventType: "new_bid_request",
          title: `New Bid Request ${requestCode}`,
          message: `${name} requested ${requestedServices} at ${propertyAddress}.`,
          entityType: "bid_request",
          entityId: inserted.id
        });
        await insertSupabaseAuditLog(sb, {
          actorId: null,
          actorEmail: email,
          actorRole: "Public Visitor",
          action: "bid_request_submitted",
          entityType: "bid_request",
          entityId: inserted.id,
          summary: `Public bid request ${requestCode} submitted for ${propertyAddress}.`
        });
        res.status(201).json({
          requestCode: inserted.request_code,
          id: inserted.id,
          createdAt: inserted.created_at
        });
        return;
      }
      const db = getDbState();
      const record = {
        id: crypto8.randomUUID(),
        requestCode,
        contactName: name,
        email,
        phone,
        propertyAddress,
        city,
        state: stateCode,
        zipCode,
        requestedServices,
        notes,
        estimatorData,
        status: "New",
        internalNotes: "",
        convertedWorkOrderId: null,
        isArchived: false,
        createdAt: now,
        updatedAt: now
      };
      db.bidRequests.unshift(record);
      appendNotification(db, {
        eventType: "new_bid_request",
        title: `New Bid Request ${requestCode}`,
        message: `${name} requested ${requestedServices} at ${propertyAddress}.`,
        entityType: "bid_request",
        entityId: record.id
      });
      appendActivityLog(db, {
        actorId: null,
        actorEmail: email,
        actorRole: "Public Visitor",
        action: "bid_request_submitted",
        entityType: "bid_request",
        entityId: record.id,
        summary: `Public bid request ${requestCode} submitted for ${propertyAddress}.`
      });
      saveDbState(db);
      res.status(201).json({ requestCode, id: record.id, createdAt: now });
    } catch (err) {
      next(err);
    }
  });
  router.post("/public/dispatch-requests", publicSubmitLimiter, async (req, res, next) => {
    try {
      const contactName = sanitizeText(req.body?.name || req.body?.contactName, 120);
      const phone = sanitizeText(req.body?.phone, 40);
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const propertyAddress = sanitizeText(
        req.body?.propertyLocation || req.body?.propertyAddress,
        240
      );
      const city = sanitizeText(req.body?.city, 80);
      const stateCode = sanitizeText(req.body?.state, 40);
      const zipCode = sanitizeText(req.body?.zipCode, 20);
      const emergencyType = sanitizeText(req.body?.topic || req.body?.emergencyType, 160) || "Emergency Board-Up / Securing";
      const description = sanitizeText(req.body?.message || req.body?.description, 2e3);
      if (!contactName || phone.length < 7 || !propertyAddress) {
        res.status(400).json({
          error: "Please enter your name, callback phone number, and property location."
        });
        return;
      }
      const dispatchCode = `URG-${Math.floor(1e5 + Math.random() * 899999)}`;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const initialTimeline = [
        {
          id: crypto8.randomUUID(),
          actorName: contactName,
          description: `Urgent dispatch request ${dispatchCode} created via live dispatch widget.`,
          createdAt: now
        }
      ];
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error } = await sb.from("dispatch_requests").insert({
          dispatch_code: dispatchCode,
          contact_name: contactName,
          phone,
          email,
          property_address: propertyAddress,
          city,
          state: stateCode,
          zip_code: zipCode,
          emergency_type: emergencyType,
          description,
          priority: "Urgent",
          status: "New",
          internal_notes: "",
          timeline: initialTimeline
        }).select("id, dispatch_code, submitted_at").single();
        if (error || !inserted) {
          res.status(500).json({ error: error?.message || "Unable to save dispatch request." });
          return;
        }
        await insertSupabaseNotification(sb, {
          eventType: "new_dispatch_request",
          title: `Urgent Dispatch ${dispatchCode}`,
          message: `${emergencyType} reported at ${propertyAddress} (${phone}).`,
          entityType: "dispatch",
          entityId: inserted.id
        });
        await insertSupabaseAuditLog(sb, {
          actorId: null,
          actorEmail: email || phone,
          actorRole: "Public Visitor",
          action: "dispatch_submitted",
          entityType: "dispatch",
          entityId: inserted.id,
          summary: `Urgent dispatch ${dispatchCode} logged for ${propertyAddress}.`
        });
        res.status(201).json({
          dispatchCode: inserted.dispatch_code,
          id: inserted.id,
          submittedDate: inserted.submitted_at
        });
        return;
      }
      const db = getDbState();
      const record = {
        id: crypto8.randomUUID(),
        dispatchCode,
        contactName,
        phone,
        email,
        propertyAddress,
        city,
        state: stateCode,
        zipCode,
        emergencyType,
        description,
        priority: "Urgent",
        status: "New",
        assignedVendorId: null,
        assignedVendorName: "",
        internalNotes: "",
        timeline: initialTimeline,
        submittedDate: now,
        updatedAt: now
      };
      db.dispatchRequests.unshift(record);
      appendNotification(db, {
        eventType: "new_dispatch_request",
        title: `Urgent Dispatch ${dispatchCode}`,
        message: `${emergencyType} reported at ${propertyAddress} (${phone}).`,
        entityType: "dispatch",
        entityId: record.id
      });
      appendActivityLog(db, {
        actorId: null,
        actorEmail: email || phone,
        actorRole: "Public Visitor",
        action: "dispatch_submitted",
        entityType: "dispatch",
        entityId: record.id,
        summary: `Urgent dispatch ${dispatchCode} logged for ${propertyAddress}.`
      });
      saveDbState(db);
      res.status(201).json({ dispatchCode, id: record.id, submittedDate: now });
    } catch (err) {
      next(err);
    }
  });
  router.post("/public/vendor-applications", publicSubmitLimiter, async (req, res, next) => {
    try {
      const companyName = sanitizeText(req.body?.companyName, 140);
      const contactPerson = sanitizeText(
        req.body?.contactName || req.body?.contactPerson,
        120
      );
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const phone = sanitizeText(req.body?.phone, 40);
      const coverageAreas = sanitizeText(
        req.body?.statesCovered || req.body?.coverageAreas,
        240
      );
      const trades = Array.isArray(req.body?.trades) ? req.body.trades.map((t) => sanitizeText(t, 80)).filter(Boolean) : [];
      const hasInsurance = Boolean(req.body?.hasInsurance);
      if (!companyName || !contactPerson || !isValidEmail(email) || phone.length < 7) {
        res.status(400).json({
          error: "Please provide your LLC/Company name, contact name, valid email, and phone number."
        });
        return;
      }
      if (trades.length === 0) {
        res.status(400).json({ error: "Please select at least one primary field service trade." });
        return;
      }
      const vendorCode = `VND-${Math.floor(1e4 + Math.random() * 89999)}`;
      const insuranceInfo = hasInsurance ? "Applicant attested GL & ABC# compliance (Pending Verification)" : "Not attested";
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error } = await sb.from("vendors").insert({
          vendor_code: vendorCode,
          company_name: companyName,
          contact_person: contactPerson,
          email,
          phone,
          service_categories: trades,
          coverage_areas: coverageAreas,
          insurance_info: insuranceInfo,
          application_status: "Pending",
          account_status: "pending",
          is_demo: false
        }).select("id, vendor_code").single();
        if (error || !inserted) {
          res.status(500).json({ error: error?.message || "Unable to save vendor application." });
          return;
        }
        await insertSupabaseNotification(sb, {
          eventType: "new_vendor_application",
          title: `New Vendor Application ${vendorCode}`,
          message: `${companyName} (${contactPerson}) applied for ${trades.join(", ")}.`,
          entityType: "vendor",
          entityId: inserted.id
        });
        await insertSupabaseAuditLog(sb, {
          actorId: null,
          actorEmail: email,
          actorRole: "Vendor Applicant",
          action: "vendor_application_submitted",
          entityType: "vendor",
          entityId: inserted.id,
          summary: `Vendor application ${vendorCode} submitted by ${companyName}.`
        });
        res.status(201).json({ vendorCode: inserted.vendor_code, id: inserted.id });
        return;
      }
      const db = getDbState();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const record = {
        id: crypto8.randomUUID(),
        vendorCode,
        companyName,
        contactPerson,
        email,
        phone,
        address: "",
        city: "",
        state: "",
        zipCode: "",
        serviceCategories: trades,
        coverageAreas,
        counties: [],
        licenseInfo: "",
        insuranceInfo,
        aspenGroveAbc: "",
        applicationStatus: "Pending",
        accountStatus: "pending",
        rating: null,
        completedWorkOrders: 0,
        notes: "",
        isDemo: false,
        registrationDate: now,
        updatedAt: now
      };
      db.vendors.unshift(record);
      appendNotification(db, {
        eventType: "new_vendor_application",
        title: `New Vendor Application ${vendorCode}`,
        message: `${companyName} (${contactPerson}) applied for ${trades.join(", ")}.`,
        entityType: "vendor",
        entityId: record.id
      });
      appendActivityLog(db, {
        actorId: null,
        actorEmail: email,
        actorRole: "Vendor Applicant",
        action: "vendor_application_submitted",
        entityType: "vendor",
        entityId: record.id,
        summary: `Vendor application ${vendorCode} submitted by ${companyName}.`
      });
      saveDbState(db);
      res.status(201).json({ vendorCode, id: record.id });
    } catch (err) {
      next(err);
    }
  });
  router.post("/public/vendor-bids", publicSubmitLimiter, async (req, res, next) => {
    try {
      const workOrderIdentifier = sanitizeText(
        req.body?.workOrderId || req.body?.workOrderCode,
        80
      );
      const proposedPrice = Number(req.body?.proposedPrice ?? req.body?.bidAmount);
      const aspenGroveAbc = sanitizeText(req.body?.vendorCode || req.body?.aspenGroveAbc, 60);
      const vendorName = sanitizeText(req.body?.vendorName, 120) || (aspenGroveAbc ? `Field Vendor (${aspenGroveAbc})` : "Portal Vendor Applicant");
      const estimatedCompletionTime = sanitizeText(req.body?.estimatedCompletionTime, 80) || "48 Hours";
      const bidNotes = sanitizeText(req.body?.bidNotes, 1e3);
      if (!workOrderIdentifier || !Number.isFinite(proposedPrice) || proposedPrice < 25) {
        res.status(400).json({
          error: "Please select a valid work order and enter a bid of at least $25."
        });
        return;
      }
      const bidCode = `BID-${Math.floor(1e4 + Math.random() * 89999)}`;
      const roundedPrice = Math.round(proposedPrice * 100) / 100;
      const sb = getSupabaseAdminClient();
      if (sb) {
        const woQuery = sb.from("work_orders").select("id, work_order_code").eq("is_archived", false);
        const { data: wo2 } = isUuid(workOrderIdentifier) ? await woQuery.eq("id", workOrderIdentifier).maybeSingle() : await woQuery.eq("work_order_code", workOrderIdentifier).maybeSingle();
        if (!wo2) {
          res.status(404).json({ error: "Referenced work order was not found or is closed." });
          return;
        }
        let matchedVendor2 = null;
        if (aspenGroveAbc) {
          const { data: v } = await sb.from("vendors").select("id, company_name").ilike("aspen_grove_abc", aspenGroveAbc).maybeSingle();
          matchedVendor2 = v;
        }
        const resolvedVendorName = matchedVendor2?.company_name ?? vendorName;
        const { data: inserted, error } = await sb.from("vendor_bids").insert({
          bid_code: bidCode,
          work_order_id: wo2.id,
          vendor_id: matchedVendor2?.id ?? null,
          vendor_name: resolvedVendorName,
          aspen_grove_abc: aspenGroveAbc,
          proposed_price: roundedPrice,
          estimated_completion_time: estimatedCompletionTime,
          bid_notes: bidNotes,
          attachments: [],
          status: "Submitted",
          clarification_note: ""
        }).select("id, bid_code").single();
        if (error || !inserted) {
          res.status(500).json({ error: error?.message || "Unable to submit vendor bid." });
          return;
        }
        await insertSupabaseWorkOrderTimeline(
          sb,
          wo2.id,
          resolvedVendorName,
          "bid_submitted",
          `Vendor bid ${bidCode} submitted for $${roundedPrice.toLocaleString()}.`
        );
        await insertSupabaseNotification(sb, {
          eventType: "new_vendor_bid",
          title: `New Vendor Bid ${bidCode}`,
          message: `${resolvedVendorName} bid $${roundedPrice.toLocaleString()} on ${wo2.work_order_code}.`,
          entityType: "work_order",
          entityId: wo2.id
        });
        res.status(201).json({
          bidCode: inserted.bid_code,
          id: inserted.id,
          workOrderCode: wo2.work_order_code
        });
        return;
      }
      const db = getDbState();
      const wo = db.workOrders.find(
        (w) => !w.isArchived && (w.id === workOrderIdentifier || w.workOrderCode === workOrderIdentifier)
      );
      if (!wo) {
        res.status(404).json({ error: "Referenced work order was not found or is closed." });
        return;
      }
      const matchedVendor = aspenGroveAbc ? db.vendors.find((v) => v.aspenGroveAbc.toLowerCase() === aspenGroveAbc.toLowerCase()) : void 0;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const record = {
        id: crypto8.randomUUID(),
        bidCode,
        workOrderId: wo.id,
        workOrderCode: wo.workOrderCode,
        vendorId: matchedVendor?.id ?? null,
        vendorName: matchedVendor?.companyName ?? vendorName,
        aspenGroveAbc,
        proposedPrice: roundedPrice,
        estimatedCompletionTime,
        bidNotes,
        attachments: [],
        status: "Submitted",
        clarificationNote: "",
        submittedDate: now,
        updatedAt: now
      };
      db.vendorBids.unshift(record);
      appendWorkOrderTimeline(
        db,
        wo.id,
        record.vendorName,
        "bid_submitted",
        `Vendor bid ${bidCode} submitted for $${record.proposedPrice.toLocaleString()}.`
      );
      appendNotification(db, {
        eventType: "new_vendor_bid",
        title: `New Vendor Bid ${bidCode}`,
        message: `${record.vendorName} bid $${record.proposedPrice.toLocaleString()} on ${wo.workOrderCode}.`,
        entityType: "work_order",
        entityId: wo.id
      });
      saveDbState(db);
      res.status(201).json({ bidCode, id: record.id, workOrderCode: wo.workOrderCode });
    } catch (err) {
      next(err);
    }
  });
  router.post("/public/messages", publicSubmitLimiter, async (req, res, next) => {
    try {
      const senderName = sanitizeText(req.body?.name || req.body?.senderName, 120);
      const senderEmail = sanitizeText(req.body?.email || req.body?.senderEmail, 254).toLowerCase();
      const senderPhone = sanitizeText(req.body?.phone || req.body?.senderPhone, 40);
      const subject = sanitizeText(req.body?.subject, 160) || "General Inquiry";
      const body = sanitizeText(req.body?.body || req.body?.message, 3e3);
      const source = sanitizeText(req.body?.source, 60) || "Contact Form";
      if (!senderName || !senderEmail && !senderPhone || !body) {
        res.status(400).json({ error: "Please include your name, email or phone, and message." });
        return;
      }
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error } = await sb.from("messages").insert({
          sender_name: senderName,
          sender_email: senderEmail,
          sender_phone: senderPhone,
          subject,
          body,
          source,
          status: "Unread",
          internal_notes: ""
        }).select("id").single();
        if (error || !inserted) {
          res.status(500).json({ error: error?.message || "Unable to submit message." });
          return;
        }
        await insertSupabaseNotification(sb, {
          eventType: "new_message",
          title: "New Contact Message",
          message: `${senderName}: ${subject}`,
          entityType: "message",
          entityId: inserted.id
        });
        res.status(201).json({ id: inserted.id });
        return;
      }
      const db = getDbState();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const record = {
        id: crypto8.randomUUID(),
        senderName,
        senderEmail,
        senderPhone,
        subject,
        body,
        source,
        status: "Unread",
        internalNotes: "",
        linkedClientId: null,
        linkedBidRequestId: null,
        linkedWorkOrderId: null,
        linkedDispatchId: null,
        createdAt: now,
        updatedAt: now
      };
      db.messages.unshift(record);
      appendNotification(db, {
        eventType: "new_message",
        title: "New Contact Message",
        message: `${senderName}: ${subject}`,
        entityType: "message",
        entityId: record.id
      });
      saveDbState(db);
      res.status(201).json({ id: record.id });
    } catch (err) {
      next(err);
    }
  });
}

// server/routes.ts
function createApiRouter() {
  const router = express.Router();
  router.use((req, res, next) => {
    if (isProductionEnvironment() && !isServerSupabaseConfigured() && req.path !== "/admin/auth/status" && req.path !== "/public/maps-config") {
      res.status(503).json({
        error: "Production persistence is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local JSON persistence is disabled in production)."
      });
      return;
    }
    next();
  });
  registerPublicRoutes(router);
  registerAuthAndUsersRoutes(router);
  registerOperationsRoutes(router);
  registerCmsAndSystemRoutes(router);
  router.use((req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });
  router.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : "Internal server error.";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });
  return router;
}

// server/app.ts
function createApiApp(options = {}) {
  const { includeErrorHandler = true, mountRootApi = false } = options;
  const app2 = express2();
  app2.set("trust proxy", 1);
  app2.use(securityHeadersMiddleware);
  app2.use(express2.json({ limit: "2mb" }));
  app2.use(express2.urlencoded({ extended: true, limit: "2mb" }));
  const apiRouter = createApiRouter();
  app2.use("/api", apiRouter);
  if (mountRootApi) {
    app2.use("/", apiRouter);
  }
  if (includeErrorHandler) {
    app2.use((err, _req, res, _next) => {
      const message = err instanceof Error ? err.message : "Unexpected server error.";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    });
  }
  return app2;
}

// server/vercel-entry.ts
var app = createApiApp({ includeErrorHandler: true, mountRootApi: true });
function normalizeVercelApiUrl(rawUrl, headers) {
  const urlStr = rawUrl || "/api";
  try {
    const parsed = new URL(urlStr, "http://localhost");
    const rewrittenPath = parsed.searchParams.get("__vercel_api_path");
    if (rewrittenPath !== null) {
      parsed.searchParams.delete("__vercel_api_path");
      const cleanSubpath = rewrittenPath.replace(/^\/+/, "");
      const targetPath = cleanSubpath ? `/api/${cleanSubpath}` : "/api";
      const qs = parsed.searchParams.toString();
      return qs ? `${targetPath}?${qs}` : targetPath;
    }
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (decodedPath === "/api" || decodedPath === "/api/index") {
      const headerUri = typeof headers?.["x-vercel-original-uri"] === "string" && headers["x-vercel-original-uri"] || typeof headers?.["x-invoke-path"] === "string" && headers["x-invoke-path"] || "";
      if (headerUri.startsWith("/api/") && headerUri !== "/api/index") {
        const headerParsed = new URL(headerUri, "http://localhost");
        const qs2 = parsed.searchParams.toString();
        return qs2 ? `${headerParsed.pathname}?${qs2}` : headerParsed.pathname;
      }
      const qs = parsed.searchParams.toString();
      return qs ? `/api?${qs}` : "/api";
    }
    return urlStr;
  } catch {
    return urlStr;
  }
}
function handler(req, res) {
  req.url = normalizeVercelApiUrl(req.url, req.headers);
  app(req, res);
}
export {
  handler as default,
  normalizeVercelApiUrl
};
