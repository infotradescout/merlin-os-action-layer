const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const XLSX = require(path.join(__dirname, "parser", "node_modules", "xlsx"));
const ExcelJS = require(path.join(__dirname, "parser", "node_modules", "exceljs"));

const ROOT = __dirname;
const DOWNLOADS = path.join(ROOT, "downloads");
const OUT_XLSX = path.join(ROOT, "Business Lists Master - Profile Seeds - Deduped - 2026-07-05.xlsx");
const OUT_SUMMARY = path.join(ROOT, "build_summary.json");

const PROFILE = {
  FOOD: "Restaurants/Food Trucks/Bars",
  HOST: "Hosts",
  CONTRACTOR: "Contractors",
};

const SOURCE_URLS = {
  "Bar Owner Calls.xlsx": "https://docs.google.com/spreadsheets/d/10Du7dmrwNyW8lKgPhPJm0TaCWVyC6Z1Z3PFnBt671l8",
  "DBPR_Active_Mobile_Vendors_Calling_Sheet.xlsx": "https://drive.google.com/file/d/1-lGs560XXJiDY3lpVaPF1cPTVoTspvJD",
  "DBPR_MFDV_Escambia_174.xlsx": "https://drive.google.com/file/d/1F7-7dFNr8nKDuHyQUq1fszlnmbtz24CF",
  "DBPR_MFDV_Master_926.xlsx": "https://drive.google.com/file/d/1uh9xtFiEmArZxHaFBz-gvt0M8298VtfQ",
  "DBPR_MFDV_SantaRosa_96.xlsx": "https://drive.google.com/file/d/18V2eU1IrDJzDtVtM51NQM2-MACpEigjj",
  "Escambia County Zip Code-Sunbiz.xlsx": "https://docs.google.com/spreadsheets/d/1nvtPBfJ1dWd9-ie7hY8f_ANQ3VB2fkrDkr3GoEM8-rU",
  "Home Improvement Retailers B2B.xlsx": "https://drive.google.com/file/d/15e-R2KzJkT_GTLCI2zyGhCodnjvGryhO",
  "Host scrapes.xlsx": "https://docs.google.com/spreadsheets/d/102PMJPvmbA8e-tQ7aasZ1B_4j-HQGcbzAe0s8WekYwo",
  "Mealscout Log.xlsx": "https://docs.google.com/spreadsheets/d/1-geeAc56PznDrXx5JdPZZKp4AToD8G0kCmNibMblyM4",
  "MealScout Round 1.xlsx": "https://docs.google.com/spreadsheets/d/1Jbb4h1YoZbor2gY1RxIDOB3_WZhqmSuC0ol7NVWpBnU",
  "Pensacola food trucks emails.xlsx": "https://docs.google.com/spreadsheets/d/1mdR3eofMlXatMgpvuwbKDdrxwHwbl1WTvQCmOjKNjMw",
  "Property Management Leads.xlsx": "https://docs.google.com/spreadsheets/d/1OOXPtW5epTeErQbS5w9uVOiyL3IRr022Qh_2UnFa0Sw",
  "Territory Division MASTER SHEET.xlsx": "https://docs.google.com/spreadsheets/d/1cIMrENuKisGyb-249tOAugT4qYw8qePS_zWZPnQjk4M",
  "TradeScout Directory.xlsx": "https://docs.google.com/spreadsheets/d/10HegeRlL5Y8JLbOHjBF2E89b2pz6whAAAQF9KqeOn_w",
  "Truck Owner Calls(5-30-26).xlsx": "https://docs.google.com/spreadsheets/d/100yNnK693VjXzEUQzheMcksjJNCgacDPDTHzV-MNgE4",
  "host_traffic_estimator_clean_v2.xlsx": "https://drive.google.com/file/d/1MqgBq__1KVW9fGKYiaLJLavOXN5pctWu",
};

const REMOTE_INVENTORY_ONLY = [
  {
    source_file: "gulf_run",
    source_url: "https://docs.google.com/spreadsheets/d/11AjN8tE9PgNGgIiXk5_vPtshZsUoFI71ahzRUiOzIvg",
    source_tab: "gulf_run",
    status: "inventory_only_export_blocked",
    raw_rows: 298887,
    profile_records_added: 0,
    restaurants_food_trucks_bars: 0,
    hosts: 0,
    contractors: 0,
    notes: "Drive blocked XLSX and CSV export with 403. Metadata and sample confirm this is a contractor/license sheet that overlaps the Home Improvement Retailers B2B contractor-license export.",
  },
];

const EXCLUDED_SCREENSHOTS = [
  ["MealScout Screenshot Processing Final Sheet 2026-06-09", "https://docs.google.com/spreadsheets/d/1Qm7gwETnNlZNcXFJG5FuxhAWPyuKc7gqd02nyCBVf34"],
  ["My Copy of MealScout Screenshot Processing Final Sheet", "https://docs.google.com/spreadsheets/d/1eSf1mC4tS4YaxagSo8bpXsvJ9Z2uowfQ5IXyMZjcYsk"],
  ["MealScout Screenshot Processing Corrected Rename Sheet 2026-06-09", "https://docs.google.com/spreadsheets/d/1yOgl3h0S-ha63FlITmq6DI8JRmOgQcxTV8GlZZQHRUc"],
  ["MealScout Screenshot Processing Rename Sheet 2026-06-09", "https://docs.google.com/spreadsheets/d/116iFlvmYGDKuqu044wo5QNfhQwFCtri4mmC7Ct4GO00"],
];

const STATE_MAP = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", florida: "FL", georgia: "GA", louisiana: "LA",
  mississippi: "MS", texas: "TX",
};

const NAME_ALIASES = ["business", "business_name", "businessname", "company_name", "company", "name", "food_truck_name", "truck_name", "host_name"];
const LICENSE_ALIASES = ["license", "license_number", "license_no", "license_num", "license_"];
const PHONE_ALIASES = ["phone", "phones", "number", "contact_phone", "contact_details"];
const EMAIL_ALIASES = ["email", "email_", "contact_email"];
const WEBSITE_ALIASES = ["website", "web_site", "google_search", "source_url"];
const FACEBOOK_ALIASES = ["facebook", "facebook_page", "facebook_search", "fb"];
const INSTAGRAM_ALIASES = ["instagram", "instagram_search", "ig"];
const IMAGE_ALIASES = [
  "image", "images", "image_url", "image_urls", "image_link", "image_links",
  "photo", "photos", "photo_url", "photo_urls", "picture", "pictures",
  "logo", "logo_url", "featured_image", "featured image", "thumbnail",
  "media", "media_url", "media_urls", "asset", "attachment", "attachments",
  "gallery", "business_image", "business_photo", "profile_image",
];
const ADDRESS_ALIASES = ["address", "fulladdress", "full_address", "mailing_address", "business_address", "street", "location"];
const CITY_ALIASES = ["city", "municipality", "area", "service_area_city_county", "city_state"];
const COUNTY_ALIASES = ["county"];
const STATE_ALIASES = ["state", "sourcestate"];
const ZIP_ALIASES = ["zip", "zipcode", "zip_code"];
const CATEGORY_ALIASES = ["category", "categories", "classification", "license_type", "trade_type", "property_type", "food_status", "business_type"];
const STATUS_ALIASES = ["status", "operating_status", "approved", "approved_", "stage"];
const CONTACT_ALIASES = ["contact_name", "owner_contact_name", "owner", "registered_agent_officer_owner", "best_contact"];
const NOTES_ALIASES = ["notes", "source_notes", "report", "calls", "food_status"];

const FOOD_TERMS = [
  "restaurant", "food truck", "mobile food", "mfdv", "caterer", "catering", "cafe", "coffee",
  "bakery", "barbecue", "bbq", "taco", "taqueria", "pizza", "seafood", "grill", "kitchen",
  "diner", "bistro", "eatery", "dessert", "ice cream", "smoothie", "juice", "brewery",
  "bar", "pub", "lounge", "cocktail", "tavern", "nightclub", "wine", "beer", "food vendor",
];
const BAR_TERMS = ["bar", "pub", "lounge", "brewery", "cocktail", "tavern", "nightclub", "beer", "wine bar"];
const HOST_TERMS = [
  "gas station", "fuel", "convenience", "laundromat", "laundry", "property management",
  "apartment", "shopping center", "plaza", "retail", "parking", "market", "grocery",
];
const CONTRACTOR_TERMS = [
  "contractor", "construction", "remodel", "renovation", "repair", "roof", "plumb", "hvac",
  "air conditioning", "electrical", "electric", "painter", "painting", "concrete", "carpenter",
  "carpentry", "floor", "landscap", "lawn", "handyman", "builder", "drywall", "masonry",
  "cabinet", "pool", "fence", "gutter", "restoration", "insulation", "solar", "mechanical",
  "excavat", "septic", "home improvement", "trades", "architect", "ceiling", "window",
  "door", "tile", "granite", "countertop", "foundation", "garage", "glass", "waterproof",
];

const GENERIC_DOMAINS = new Set([
  "facebook.com", "instagram.com", "google.com", "maps.google.com", "search.google.com",
  "yelp.com", "linkedin.com", "x.com", "twitter.com",
]);

const records = [];
const inventory = [];
const reviewRows = [];

function clean(value) {
  if (value === undefined || value === null) return "";
  let text = String(value)
    .replace(/\u0000/g, "")
    .replace(/\u200b/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(nan|null|none|undefined)$/i.test(text)) return "";
  return text;
}

function hnorm(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normText(value) {
  return clean(value).toLowerCase();
}

function containsTerm(text, terms) {
  const hay = ` ${normText(text)} `;
  return terms.some((term) => hay.includes(term));
}

function normalizeName(name) {
  let text = clean(name).toLowerCase();
  text = text.replace(/&/g, " and ");
  text = text.replace(/['".,/#()\-]/g, " ");
  text = text.replace(/\b(dba|d b a|llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|pa|p a|pllc|p l l c)\b/g, " ");
  text = text.replace(/\b(the|and)\b/g, " ");
  return text.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeAddress(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLicense(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function normalizeState(value) {
  const text = clean(value);
  if (!text) return "";
  const lower = text.toLowerCase();
  if (STATE_MAP[lower]) return STATE_MAP[lower];
  const match = text.match(/\b([A-Z]{2})\b/);
  return match ? match[1].toUpperCase() : text.toUpperCase().slice(0, 2);
}

function extractPhone(...values) {
  const text = values.map(clean).filter(Boolean).join(" ");
  const candidates = text.match(/(?:\+?1[\s\-.()]*)?(?:\(?\d{3}\)?[\s\-.]*)\d{3}[\s\-.]*\d{4}/g) || [];
  for (const candidate of candidates) {
    let digits = candidate.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  const digitsOnly = text.replace(/\D/g, "");
  if (digitsOnly.length === 10) return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    const d = digitsOnly.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return "";
}

function phoneKey(value) {
  return clean(value).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

function extractEmail(...values) {
  const text = values.map(clean).join(" ");
  const match = text.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function normalizeUrl(value) {
  let text = clean(value);
  if (!text || text.startsWith("@") || text.includes("@") && !/^https?:\/\//i.test(text)) return "";
  const urlMatch = text.match(/https?:\/\/[^\s,]+/i);
  if (urlMatch) text = urlMatch[0];
  if (!/^https?:\/\//i.test(text) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) text = `https://${text}`;
  if (!/^https?:\/\//i.test(text)) return "";
  return text.replace(/[),.;]+$/g, "");
}

function extractLinks(...values) {
  const seen = [];
  const text = values.map(clean).filter(Boolean).join(" ");
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const match of matches) {
    const url = match.replace(/[),.;\]]+$/g, "");
    if (url && !seen.includes(url)) seen.push(url);
  }
  return seen;
}

function domainOf(value) {
  const url = normalizeUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function socialKey(value, network) {
  let text = clean(value).toLowerCase();
  if (!text) return "";
  if (text.startsWith("@")) return text.slice(1).replace(/[^a-z0-9._-]/g, "");
  const url = normalizeUrl(text);
  if (url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      if (!host.includes(network)) return "";
      return parsed.pathname.split("/").filter(Boolean)[0] || "";
    } catch {
      return "";
    }
  }
  return text.replace(/[^a-z0-9._-]/g, "");
}

function mapsCid(value) {
  const url = normalizeUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("cid") || parsed.searchParams.get("placeid") || "";
  } catch {
    return "";
  }
}

function parseCityStateZip(text) {
  const value = clean(text);
  if (!value) return {};
  const direct = value.match(/^(.+?),\s*([A-Z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/i);
  if (direct) return { city: clean(direct[1]), state: normalizeState(direct[2]), zip: direct[3] || "" };
  const atEnd = value.match(/(?:^|,|\s)([A-Za-z .'\-]+),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/);
  if (atEnd) return { city: clean(atEnd[1]), state: normalizeState(atEnd[2]), zip: atEnd[3] };
  const zipOnly = value.match(/\b(\d{5})(?:-\d{4})?\b/);
  return { zip: zipOnly ? zipOnly[1] : "" };
}

function mergeLocation({ address, city, state, zip }) {
  const parsedCity = parseCityStateZip(city);
  const parsedAddress = parseCityStateZip(address);
  const dashCity = clean(address).match(/[\u2013\u2014]\s*([A-Za-z .'\-]+)$/);
  return {
    address: clean(address),
    city: clean(city && !parsedCity.state ? city : parsedCity.city || parsedAddress.city || (dashCity ? dashCity[1] : "")),
    state: normalizeState(state || parsedCity.state || parsedAddress.state),
    zip: clean(zip || parsedCity.zip || parsedAddress.zip),
  };
}

function headerMap(headers) {
  const map = new Map();
  headers.forEach((header, idx) => {
    const key = hnorm(header);
    if (key && !map.has(key)) map.set(key, idx);
  });
  return map;
}

function getByAliases(row, map, aliases) {
  for (const alias of aliases) {
    const idx = map.get(hnorm(alias));
    if (idx !== undefined) {
      const value = clean(row[idx]);
      if (value) return value;
    }
  }
  return "";
}

function getAllByAliases(row, map, aliases) {
  const values = [];
  for (const alias of aliases) {
    const idx = map.get(hnorm(alias));
    if (idx !== undefined) {
      const value = clean(row[idx]);
      if (value) values.push(value);
    }
  }
  return values;
}

function headerScore(row) {
  const tokens = row.map(hnorm).filter(Boolean);
  const aliases = [
    ...NAME_ALIASES, ...LICENSE_ALIASES, ...PHONE_ALIASES, ...EMAIL_ALIASES,
    ...WEBSITE_ALIASES, ...ADDRESS_ALIASES, ...CITY_ALIASES, ...CATEGORY_ALIASES,
  ].map(hnorm);
  return tokens.filter((token) => aliases.includes(token) || token.includes("business") || token.includes("license")).length;
}

function detectHeader(rows) {
  let best = { index: -1, score: 0 };
  rows.slice(0, 12).forEach((row, index) => {
    const score = headerScore(row);
    if (score > best.score) best = { index, score };
  });
  return best.score >= 2 ? best : null;
}

function isLikelyHeaderOrInstruction(name) {
  const text = normText(name);
  if (!text) return true;
  const compact = hnorm(name);
  if ([
    "business_name", "business", "name", "company_name", "host_name", "truck_name",
    "licensee_name", "owner_name", "restaurant_name", "vendor_name",
  ].includes(compact)) return true;
  if (text.includes("instructions:") || text.includes("go to:") || text.includes("fill yellow cells")) return true;
  if (/\b(business|company|host|truck|vendor|licensee)\b/i.test(text)
    && /\b(name|phone|email|address|license|status)\b/i.test(text)) return true;

  const alnum = clean(name).match(/[A-Za-z0-9]/g) || [];
  const letters = clean(name).match(/[A-Za-z]/g) || [];
  if (alnum.length < 2) return true;
  if (!letters.length && alnum.length < 4) return true;
  if (normalizeName(name).length < 2) return true;
  return false;
}

function registerReview(reason, input) {
  if (reviewRows.length >= 50000) return;
  reviewRows.push({
    review_reason: reason,
    profile_type: input.profile_type || "",
    business_name: input.business_name || "",
    business_category: input.business_category || "",
    license_number: input.license_number || "",
    phone: input.phone || "",
    email: input.email || "",
    website: input.website || "",
    address: input.address || "",
    city: input.city || "",
    state: input.state || "",
    source_file: input.source_file || "",
    source_tab: input.source_tab || "",
    source_row: input.source_row || "",
    notes: input.notes || "",
  });
}

function sourceFamilyFor(file, sheet) {
  const f = file.toLowerCase();
  const s = sheet.toLowerCase();
  if (f.includes("dbpr") || f.includes("mealscout") || f.includes("food truck") || f.includes("truck owner")) return "food_vendor";
  if (f.includes("bar owner")) return "bar";
  if (f.includes("host scrapes")) return "host_site";
  if (f.includes("property management")) return "property_management";
  if (f.includes("home improvement") || f.includes("tradescout")) return "contractor";
  if (f.includes("sunbiz")) return "sunbiz";
  if (s.includes("host")) return "host_site";
  return "business_list";
}

function addRecord(input) {
  const name = clean(input.business_name);
  if (isLikelyHeaderOrInstruction(name)) {
    if (!name && clean(input.phone || input.email || input.license_number)) registerReview("missing_business_name", input);
    return false;
  }

  const location = mergeLocation(input);
  const phone = extractPhone(input.phone, input.notes);
  const email = extractEmail(input.email, input.notes);
  const website = normalizeUrl(input.website);
  const facebook = normalizeUrl(input.facebook) || clean(input.facebook);
  const instagram = clean(input.instagram);
  const imageLinks = extractLinks(input.image_links).join("; ");
  const license = clean(input.license_number);
  const category = clean(input.business_category || input.raw_category);
  const status = clean(input.status);

  if (!name && !license && !phone && !email && !website) {
    return false;
  }

  const record = {
    id: records.length,
    profile_type: input.profile_type,
    source_family: clean(input.source_family),
    source_file: clean(input.source_file),
    source_tab: clean(input.source_tab),
    source_row: clean(input.source_row),
    source_url: SOURCE_URLS[input.source_file] || "",
    business_name: name,
    business_category: category || defaultCategory(input.profile_type, input.source_family),
    sub_category: clean(input.sub_category),
    license_number: license,
    license_key: normalizeLicense(license),
    status,
    phone,
    phone_key: phoneKey(phone),
    email,
    email_key: email.toLowerCase(),
    website,
    image_links: imageLinks,
    domain: domainOf(website),
    facebook,
    facebook_key: socialKey(facebook, "facebook"),
    instagram,
    instagram_key: socialKey(instagram, "instagram"),
    maps_url: clean(input.maps_url),
    maps_key: mapsCid(input.maps_url),
    address: location.address,
    address_key: normalizeAddress(location.address),
    city: clean(location.city),
    city_key: normalizeName(location.city),
    county: clean(input.county),
    state: normalizeState(location.state),
    zip: clean(location.zip),
    contact_name: clean(input.contact_name),
    notes: clean(input.notes),
    normalized_name: normalizeName(name),
  };

  if (!record.profile_type || !record.business_name) return false;
  records.push(record);
  return true;
}

function defaultCategory(profileType, family) {
  if (profileType === PROFILE.FOOD) return family === "bar" ? "Bar" : "Restaurant / Food Truck";
  if (profileType === PROFILE.HOST) return family === "property_management" ? "Property Management" : "Host Prospect";
  if (profileType === PROFILE.CONTRACTOR) return "Contractor / Trade";
  return "";
}

function classifySunbiz(category, name) {
  const text = `${category} ${name}`;
  if (containsTerm(text, FOOD_TERMS)) return PROFILE.FOOD;
  if (containsTerm(text, CONTRACTOR_TERMS)) return PROFILE.CONTRACTOR;
  if (containsTerm(text, HOST_TERMS)) return PROFILE.HOST;
  return "";
}

function classifyGeneric(file, sheet, row, map) {
  const f = file.toLowerCase();
  const s = sheet.toLowerCase();
  const category = getByAliases(row, map, CATEGORY_ALIASES);
  const name = getByAliases(row, map, NAME_ALIASES);
  const text = `${file} ${sheet} ${category} ${name}`;

  if (f.includes("bar owner")) return PROFILE.FOOD;
  if (f.includes("property management") || f.includes("host scrapes")) return PROFILE.HOST;
  if (f.includes("dbpr") || f.includes("mfdv") || f.includes("food truck")) return PROFILE.FOOD;
  if (f.includes("pensacola food trucks")) return PROFILE.FOOD;
  if (f.includes("mealscout") && (s.includes("host") || s.includes("possible host"))) return PROFILE.HOST;
  if (f.includes("mealscout")) return PROFILE.FOOD;
  if (f.includes("home improvement")) return PROFILE.CONTRACTOR;
  if (f.includes("tradescout")) return containsTerm(text, CONTRACTOR_TERMS) ? PROFILE.CONTRACTOR : "";
  if (containsTerm(text, FOOD_TERMS)) return PROFILE.FOOD;
  if (containsTerm(text, CONTRACTOR_TERMS)) return PROFILE.CONTRACTOR;
  if (containsTerm(text, HOST_TERMS)) return PROFILE.HOST;
  return "";
}

function categoryForFoodBar(file, category, name) {
  const text = `${file} ${category} ${name}`;
  if (containsTerm(text, BAR_TERMS)) return "Bar / Brewery / Lounge";
  if (containsTerm(text, ["food truck", "mobile food", "mfdv", "food vendor"])) return "Food Truck / Mobile Vendor";
  if (containsTerm(text, ["caterer", "catering"])) return "Caterer";
  return category || "Restaurant / Food Truck";
}

function processSunbiz(file, sheet, rows, context) {
  const counts = { added: 0, food: 0, host: 0, contractor: 0 };
  rows.forEach((row, idx) => {
    const zip = clean(row[0]);
    const category = clean(row[1] || row[2]);
    const businessName = clean(row[3]);
    if (!businessName || isLikelyHeaderOrInstruction(businessName)) return;
    const profile = classifySunbiz(category, businessName);
    if (!profile) return;
    const added = addRecord({
      profile_type: profile,
      source_family: "sunbiz",
      source_file: file,
      source_tab: sheet,
      source_row: idx + 1,
      business_name: businessName,
      business_category: profile === PROFILE.FOOD ? categoryForFoodBar(file, category, businessName) : category,
      status: "",
      address: row[5],
      city: "",
      state: "FL",
      zip,
      contact_name: row[6],
      phone: row[7],
      email: row[8],
      website: row[9],
      notes: clean(row.slice(10).join(" ")),
    });
    if (added) {
      counts.added += 1;
      if (profile === PROFILE.FOOD) counts.food += 1;
      if (profile === PROFILE.HOST) counts.host += 1;
      if (profile === PROFILE.CONTRACTOR) counts.contractor += 1;
    }
  });
  return counts;
}

function processFoodVendorHeaderless(file, sheet, rows) {
  const counts = { added: 0, food: 0, host: 0, contractor: 0 };
  rows.forEach((row, idx) => {
    const name = clean(row[0]);
    if (!name || isLikelyHeaderOrInstruction(name)) return;
    const added = addRecord({
      profile_type: PROFILE.FOOD,
      source_family: "food_vendor",
      source_file: file,
      source_tab: sheet,
      source_row: idx + 1,
      business_name: name,
      business_category: "Food Truck / Mobile Vendor",
      license_number: row[1],
      phone: row[2],
      contact_name: row[3],
      address: row[4],
      county: row[5],
      state: row[6],
      website: row[7],
      notes: clean(row.slice(8).join(" ")),
    });
    if (added) {
      counts.added += 1;
      counts.food += 1;
    }
  });
  return counts;
}

function processMealScoutFlorida(file, sheet, rows) {
  const counts = { added: 0, food: 0, host: 0, contractor: 0 };
  rows.slice(1).forEach((row, idx) => {
    const name = clean(row[0]);
    if (!name || isLikelyHeaderOrInstruction(name)) return;
    const added = addRecord({
      profile_type: PROFILE.FOOD,
      source_family: "food_vendor",
      source_file: file,
      source_tab: sheet,
      source_row: idx + 2,
      business_name: name,
      business_category: "Restaurant / Food Truck",
      address: row[1],
      phone: row[2],
      notes: clean(row.slice(3).join(" ")),
    });
    if (added) {
      counts.added += 1;
      counts.food += 1;
    }
  });
  return counts;
}

function processTruckOwnerCalls(file, sheet, rows) {
  rows.forEach((row, idx) => {
    const name = clean(row[0]);
    if (!name || isLikelyHeaderOrInstruction(name)) return;
    registerReview("owner_call_note_without_business_name", {
      source_file: file,
      source_tab: sheet,
      source_row: idx + 1,
      business_name: name,
      notes: clean(row.slice(1).join(" ")),
    });
  });
  return { added: 0, food: 0, host: 0, contractor: 0 };
}

function processTradePartners(file, sheet, rows) {
  const counts = { added: 0, food: 0, host: 0, contractor: 0 };
  rows.forEach((row, idx) => {
    const category = clean(row[0]);
    const name = clean(row[1]);
    if (!name || !containsTerm(`${category} ${name}`, CONTRACTOR_TERMS)) return;
    const added = addRecord({
      profile_type: PROFILE.CONTRACTOR,
      source_family: "contractor",
      source_file: file,
      source_tab: sheet,
      source_row: idx + 1,
      business_name: name,
      business_category: category || "Trade Partner",
      phone: row[2],
      website: row[3],
      city: row[4],
      state: row[5],
      notes: row[6],
    });
    if (added) {
      counts.added += 1;
      counts.contractor += 1;
    }
  });
  return counts;
}

function processGenericRows(file, sheet, rows, headerInfo) {
  const counts = { added: 0, food: 0, host: 0, contractor: 0 };
  if (!headerInfo) return counts;
  const headers = rows[headerInfo.index];
  const map = headerMap(headers);
  rows.slice(headerInfo.index + 1).forEach((row, offset) => {
    const sourceRow = headerInfo.index + 2 + offset;
    const profile = classifyGeneric(file, sheet, row, map);
    if (!profile) return;

    let name = getByAliases(row, map, NAME_ALIASES);
    if (!name && file.includes("TradeScout Directory")) name = clean(row[1]);
    if (!name) return;

    const category = getByAliases(row, map, CATEGORY_ALIASES);
    if (file === "Home Improvement Retailers B2B.xlsx" && sheet === "Sheet2" && !containsTerm(`${category} ${name}`, CONTRACTOR_TERMS)) {
      return;
    }
    if (file === "Home Improvement Retailers B2B.xlsx" && sheet === "Sheet1" && /pvdr|provider|continuing education|training ce/i.test(`${category} ${name}`)) {
      return;
    }

    const allPhones = getAllByAliases(row, map, PHONE_ALIASES);
    const allEmails = getAllByAliases(row, map, EMAIL_ALIASES);
    const allUrls = getAllByAliases(row, map, WEBSITE_ALIASES);
    const allImages = getAllByAliases(row, map, IMAGE_ALIASES);
    const allNotes = getAllByAliases(row, map, NOTES_ALIASES);
    const rawCategory = category;
    const added = addRecord({
      profile_type: profile,
      source_family: sourceFamilyFor(file, sheet),
      source_file: file,
      source_tab: sheet,
      source_row: sourceRow,
      business_name: name,
      business_category: profile === PROFILE.FOOD ? categoryForFoodBar(file, rawCategory, name) : rawCategory,
      sub_category: rawCategory,
      license_number: getByAliases(row, map, LICENSE_ALIASES),
      status: getByAliases(row, map, STATUS_ALIASES),
      phone: allPhones.join(" "),
      email: allEmails.join(" "),
      website: allUrls.join(" "),
      image_links: allImages.join(" "),
      facebook: getByAliases(row, map, FACEBOOK_ALIASES),
      instagram: getByAliases(row, map, INSTAGRAM_ALIASES),
      maps_url: getByAliases(row, map, ["google_maps_url", "maps_url"]),
      address: getByAliases(row, map, ADDRESS_ALIASES),
      city: getByAliases(row, map, CITY_ALIASES),
      county: getByAliases(row, map, COUNTY_ALIASES),
      state: getByAliases(row, map, STATE_ALIASES),
      zip: getByAliases(row, map, ZIP_ALIASES),
      contact_name: getByAliases(row, map, CONTACT_ALIASES),
      notes: allNotes.join(" "),
    });

    if (added) {
      counts.added += 1;
      if (profile === PROFILE.FOOD) counts.food += 1;
      if (profile === PROFILE.HOST) counts.host += 1;
      if (profile === PROFILE.CONTRACTOR) counts.contractor += 1;
    }
  });
  return counts;
}

function addInventory(file, sheet, rows, counts, status, notes) {
  inventory.push({
    source_file: file,
    source_url: SOURCE_URLS[file] || "",
    source_tab: sheet,
    status,
    raw_rows: rows.length,
    profile_records_added: counts.added,
    restaurants_food_trucks_bars: counts.food,
    hosts: counts.host,
    contractors: counts.contractor,
    notes,
  });
}

function processWorkbook(file) {
  const full = path.join(DOWNLOADS, file);
  const workbook = XLSX.readFile(full, { cellDates: false, dense: true, raw: false });

  for (const sheet of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheet];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "", blankrows: false });
    if (!rows.length) {
      addInventory(file, sheet, rows, { added: 0, food: 0, host: 0, contractor: 0 }, "empty", "");
      continue;
    }

    if (/screenshot processing/i.test(file) || /screenshot processing/i.test(sheet)) {
      addInventory(file, sheet, rows, { added: 0, food: 0, host: 0, contractor: 0 }, "excluded_screenshot_processing", "Screenshot-processing workflow is out of scope.");
      continue;
    }

    if (file === "host_traffic_estimator_clean_v2.xlsx") {
      addInventory(file, sheet, rows, { added: 0, food: 0, host: 0, contractor: 0 }, "skipped_auxiliary", "Host traffic calculator; not a business profile seed list.");
      continue;
    }

    if (file === "Territory Division MASTER SHEET.xlsx") {
      addInventory(file, sheet, rows, { added: 0, food: 0, host: 0, contractor: 0 }, "skipped_auxiliary", "Territory and Facebook group planning reference; not direct business profiles.");
      continue;
    }

    if (file === "DBPR_Active_Mobile_Vendors_Calling_Sheet.xlsx" && sheet === "Calling Sheet") {
      addInventory(file, sheet, rows, { added: 0, food: 0, host: 0, contractor: 0 }, "skipped_noisy_outreach_sheet", "Excluded noisy calling-sheet/OCR scaffold; clean vendor rows are in the Florida tab.");
      continue;
    }

    let counts;
    if (file === "Escambia County Zip Code-Sunbiz.xlsx") {
      counts = processSunbiz(file, sheet, rows);
      addInventory(file, sheet, rows, counts, "processed_filtered", "Filtered to food/bar, host, and contractor-like Sunbiz rows.");
      continue;
    }

    if (file === "MealScout Round 1.xlsx" || (file === "Mealscout Log.xlsx" && /whole state/i.test(sheet))) {
      counts = processFoodVendorHeaderless(file, sheet, rows);
      addInventory(file, sheet, rows, counts, "processed", "Headerless DBPR/mobile-food-vendor scrape.");
      continue;
    }

    if (file === "Mealscout Log.xlsx" && sheet === "Florida") {
      counts = processMealScoutFlorida(file, sheet, rows);
      addInventory(file, sheet, rows, counts, "processed", "MealScout Florida list with name/address/phone layout.");
      continue;
    }

    if (file === "Truck Owner Calls(5-30-26).xlsx") {
      counts = processTruckOwnerCalls(file, sheet, rows);
      addInventory(file, sheet, rows, counts, "review_only", "Rows appear to be owner/contact call notes without business names.");
      continue;
    }

    if (file === "TradeScout Directory.xlsx" && sheet === "TradePartners") {
      counts = processTradePartners(file, sheet, rows);
      addInventory(file, sheet, rows, counts, "processed_filtered", "Filtered trade partners to contractor-like rows only.");
      continue;
    }

    counts = processGenericRows(file, sheet, rows, detectHeader(rows));
    const status = counts.added ? "processed" : "no_matching_profile_rows";
    addInventory(file, sheet, rows, counts, status, counts.added ? "" : "No food/bar, host, or contractor seed rows detected.");
  }
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array(size).fill(0);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return ra;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra] += 1;
    return ra;
  }
}

function locationKey(record) {
  if (record.address_key) return `address:${record.address_key}`;
  if (record.city_key && record.state && record.zip) return `city_zip:${record.city_key}:${record.state}:${record.zip}`;
  if (record.city_key && record.state) return `city_state:${record.city_key}:${record.state}`;
  if (record.state && record.zip) return `state_zip:${record.state}:${record.zip}`;
  return "";
}

function splitByKnownKey(ids, keyForId) {
  const known = new Map();
  const unknown = [];
  for (const id of ids) {
    const key = keyForId(id);
    if (!key) {
      unknown.push(id);
      continue;
    }
    if (!known.has(key)) known.set(key, []);
    known.get(key).push(id);
  }

  if (known.size === 0) return ids.length > 1 ? [ids] : [];
  if (known.size === 1) {
    const groups = [...known.values()].filter((group) => group.length > 1);
    if (unknown.length > 1) groups.push(unknown);
    return groups;
  }

  const groups = [...known.values()].filter((group) => group.length > 1);
  if (unknown.length > 1) groups.push(unknown);
  return groups;
}

function splitByLocationAndPhone(ids) {
  const locationGroups = splitByKnownKey(ids, (id) => locationKey(records[id]));
  const groups = [];
  for (const group of locationGroups) {
    groups.push(...splitByKnownKey(group, (id) => records[id].phone_key));
  }
  return groups;
}

function buildCanonical() {
  const uf = new UnionFind(records.length);
  const buckets = [];
  const addBucket = (type, key, ids, autoMerge = true) => {
    const unique = [...new Set(ids)];
    if (key && unique.length > 1) buckets.push({ type, key, ids: unique, autoMerge });
  };
  const bucketMap = new Map();
  const put = (type, key, idx, autoMerge = true) => {
    if (!key) return;
    const fullKey = `${type}|${key}`;
    if (!bucketMap.has(fullKey)) bucketMap.set(fullKey, { type, key, ids: [], autoMerge });
    bucketMap.get(fullKey).ids.push(idx);
  };

  records.forEach((record, idx) => {
    const prefix = record.profile_type;
    if (record.license_key) put("license", `${prefix}:${record.license_key}`, idx);
    if (record.normalized_name && record.email_key) put("name_email", `${prefix}:${record.normalized_name}:${record.email_key}`, idx);
    if (record.normalized_name && record.phone_key) put("name_phone", `${prefix}:${record.normalized_name}:${record.phone_key}`, idx);
    if (record.normalized_name && record.domain && !GENERIC_DOMAINS.has(record.domain)) put("name_domain", `${prefix}:${record.normalized_name}:${record.domain}`, idx);
    if (record.normalized_name && record.facebook_key) put("name_facebook", `${prefix}:${record.normalized_name}:${record.facebook_key}`, idx);
    if (record.normalized_name && record.instagram_key) put("name_instagram", `${prefix}:${record.normalized_name}:${record.instagram_key}`, idx);
    if (record.maps_key) put("maps", `${prefix}:${record.maps_key}`, idx);
    if (record.normalized_name && record.address_key) put("name_address", `${prefix}:${record.normalized_name}:${record.address_key}`, idx);
    if (record.profile_type === PROFILE.CONTRACTOR && record.normalized_name && record.city_key && record.state) {
      put("contractor_name_city_review", `${prefix}:${record.normalized_name}:${record.city_key}:${record.state}`, idx, false);
    }
  });

  for (const item of bucketMap.values()) {
    if (!item.autoMerge || item.type === "maps") {
      addBucket(item.type, item.key, item.ids, item.autoMerge);
      continue;
    }
    for (const ids of splitByLocationAndPhone([...new Set(item.ids)])) {
      addBucket(item.type, item.key, ids, item.autoMerge);
    }
  }

  for (const bucket of buckets) {
    if (!bucket.autoMerge) continue;
    for (let i = 1; i < bucket.ids.length; i += 1) uf.union(bucket.ids[0], bucket.ids[i]);
  }

  for (const bucket of buckets.filter((b) => !b.autoMerge)) {
    const licenseSet = new Set(bucket.ids.map((id) => records[id].license_key).filter(Boolean));
    if (licenseSet.size > 1) {
      for (const id of bucket.ids.slice(0, 20)) {
        registerReview("possible_contractor_duplicate_same_name_city_conflicting_license", records[id]);
      }
    }
  }

  const groups = new Map();
  records.forEach((record, idx) => {
    const root = uf.find(idx);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(idx);
  });

  const reasonsByRoot = new Map();
  for (const bucket of buckets) {
    if (!bucket.autoMerge) continue;
    const roots = new Set(bucket.ids.map((id) => uf.find(id)));
    if (roots.size === 1) {
      const root = [...roots][0];
      if (!reasonsByRoot.has(root)) reasonsByRoot.set(root, new Set());
      reasonsByRoot.get(root).add(bucket.type);
    }
  }

  const canonical = [];
  const duplicateRows = [];
  let groupCounter = 1;
  const sortedGroups = [...groups.values()].sort((a, b) => {
    const ar = records[a[0]];
    const br = records[b[0]];
    return `${ar.profile_type}|${ar.normalized_name}`.localeCompare(`${br.profile_type}|${br.normalized_name}`);
  });

  for (const ids of sortedGroups) {
    const best = chooseBest(ids.map((id) => records[id]));
    const reasons = [...(reasonsByRoot.get(uf.find(ids[0])) || new Set())];
    const groupId = makeGroupId(best.profile_type, groupCounter++);
    const merged = mergeRecords(ids.map((id) => records[id]), best, groupId, reasons);
    canonical.push(merged);

    if (ids.length > 1) {
      for (const id of ids) {
        if (duplicateRows.length >= 100000) break;
        const record = records[id];
        duplicateRows.push({
          merge_group_id: groupId,
          profile_type: record.profile_type,
          group_size: ids.length,
          match_confidence: merged.match_confidence,
          match_reasons: reasons.join("; "),
          canonical_name: merged.business_name,
          member_name: record.business_name,
          license_number: record.license_number,
          phone: record.phone,
          email: record.email,
          website: record.website,
          address: record.address,
          city: record.city,
          state: record.state,
          source_file: record.source_file,
          source_tab: record.source_tab,
          source_row: record.source_row,
        });
      }
    }
  }

  canonical.sort((a, b) => `${a.profile_type}|${normalizeName(a.business_name)}|${a.city}`.localeCompare(`${b.profile_type}|${normalizeName(b.business_name)}|${b.city}`));
  assignSeedIds(canonical);
  return { canonical, duplicateRows };
}

function chooseBest(group) {
  return group.slice().sort((a, b) => scoreRecord(b) - scoreRecord(a))[0];
}

function scoreRecord(record) {
  let score = 0;
  for (const field of ["phone", "email", "website", "facebook", "instagram", "address", "city", "state", "zip"]) {
    if (record[field]) score += 2;
  }
  if (record.license_number) score += 1;
  if (record.source_family === "food_vendor" || record.source_family === "bar" || record.source_family === "property_management") score += 3;
  if (record.source_family === "contractor") score += 2;
  score += Math.min(record.business_name.length / 20, 3);
  return score;
}

function uniqueValues(group, field, limit = 5) {
  const seen = [];
  for (const record of group.sort((a, b) => scoreRecord(b) - scoreRecord(a))) {
    const value = clean(record[field]);
    if (value && !seen.includes(value)) seen.push(value);
    if (seen.length >= limit) break;
  }
  return seen;
}

function firstValue(group, field) {
  const values = uniqueValues(group, field, 1);
  return values[0] || "";
}

function mergeRecords(group, best, groupId, reasons) {
  const sourceKeys = [...new Set(group.map((r) => `${r.source_file}:${r.source_tab}`))];
  const hasStrong = reasons.some((r) => ["license", "name_email", "name_phone", "name_facebook", "name_instagram", "maps"].includes(r));
  const confidence = group.length === 1 ? "single" : hasStrong ? "high" : "medium";
  return {
    seed_id: "",
    profile_type: best.profile_type,
    business_name: best.business_name || firstValue(group, "business_name"),
    business_category: firstValue(group, "business_category"),
    sub_category: firstValue(group, "sub_category"),
    license_number: uniqueValues(group, "license_number", 5).join("; "),
    status: firstValue(group, "status"),
    phone: firstValue(group, "phone"),
    email: firstValue(group, "email"),
    website: firstValue(group, "website"),
    facebook: firstValue(group, "facebook"),
    instagram: firstValue(group, "instagram"),
    image_links: uniqueValues(group, "image_links", 10).join("; "),
    address: firstValue(group, "address"),
    city: firstValue(group, "city"),
    county: firstValue(group, "county"),
    state: firstValue(group, "state"),
    zip: firstValue(group, "zip"),
    contact_name: firstValue(group, "contact_name"),
    source_count: sourceKeys.length,
    sources: sourceKeys.slice(0, 12).join("; "),
    merge_group_id: groupId,
    match_confidence: confidence,
    notes: uniqueValues(group, "notes", 3).join("; ").slice(0, 500),
  };
}

function makeGroupId(profileType, num) {
  const prefix = profileType === PROFILE.FOOD ? "FOOD" : profileType === PROFILE.HOST ? "HOST" : "CONT";
  return `${prefix}-G${String(num).padStart(6, "0")}`;
}

function assignSeedIds(canonical) {
  const counters = { [PROFILE.FOOD]: 1, [PROFILE.HOST]: 1, [PROFILE.CONTRACTOR]: 1 };
  for (const row of canonical) {
    const prefix = row.profile_type === PROFILE.FOOD ? "FOOD" : row.profile_type === PROFILE.HOST ? "HOST" : "CONT";
    row.seed_id = `${prefix}-${String(counters[row.profile_type]++).padStart(6, "0")}`;
  }
}

function splitByProfile(canonical) {
  return {
    food: canonical.filter((row) => row.profile_type === PROFILE.FOOD),
    host: canonical.filter((row) => row.profile_type === PROFILE.HOST),
    contractor: canonical.filter((row) => row.profile_type === PROFILE.CONTRACTOR),
  };
}

async function writeWorkbook(summary, split, duplicateRows) {
  if (fs.existsSync(OUT_XLSX)) fs.rmSync(OUT_XLSX);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: OUT_XLSX,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = "Codex";
  workbook.created = new Date();

  await writeRows(workbook, "README", [
    "section", "value",
  ], [
    { section: "Purpose", value: "Deduplicated profile seed lists split into restaurants/food trucks/bars, hosts, and contractors." },
    { section: "Image links", value: "Business-related image/photo/logo URLs from source columns are carried into the image_links column when present." },
    { section: "Important boundary", value: "Screenshot-processing sheets were excluded; that workflow is separate." },
    { section: "Deduping", value: "Same-name rows with different known locations or different known phone numbers are kept as separate profile seeds. Merges require compatible location and phone data, except exact Maps IDs." },
    { section: "Original files", value: "Original Drive files were not edited." },
  ]);

  await writeRows(workbook, "Source Inventory", [
    "source_file", "source_url", "source_tab", "status", "raw_rows", "profile_records_added",
    "restaurants_food_trucks_bars", "hosts", "contractors", "notes",
  ], [...inventory, ...REMOTE_INVENTORY_ONLY]);

  const seedColumns = [
    "seed_id", "business_name", "business_category", "sub_category", "license_number", "status",
    "phone", "email", "website", "facebook", "instagram", "image_links", "address", "city", "county", "state",
    "zip", "contact_name", "source_count", "sources", "merge_group_id", "match_confidence", "notes",
  ];
  await writeRows(workbook, "Restaurants-Food-Bars", seedColumns, split.food);
  await writeRows(workbook, "Hosts", seedColumns, split.host);
  await writeRows(workbook, "Contractors", seedColumns, split.contractor);

  await writeRows(workbook, "Duplicate Groups", [
    "merge_group_id", "profile_type", "group_size", "match_confidence", "match_reasons",
    "canonical_name", "member_name", "license_number", "phone", "email", "website",
    "address", "city", "state", "source_file", "source_tab", "source_row",
  ], duplicateRows);

  await writeRows(workbook, "Needs Review", [
    "review_reason", "profile_type", "business_name", "business_category", "license_number",
    "phone", "email", "website", "address", "city", "state", "source_file", "source_tab",
    "source_row", "notes",
  ], reviewRows);

  await writeRows(workbook, "Excluded Screenshots", ["title", "url", "reason"], EXCLUDED_SCREENSHOTS.map(([title, url]) => ({
    title,
    url,
    reason: "Excluded because screenshot processing is separate from this business-list cleanup.",
  })));

  await writeRows(workbook, "Stats", ["metric", "value"], Object.entries(summary).map(([metric, value]) => ({
    metric,
    value: String(value),
  })));

  await workbook.commit();
}

async function writeRows(workbook, name, columns, rows) {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = columns.map((key) => ({
    header: key,
    key,
    width: Math.min(Math.max(key.length + 2, 12), key.includes("source") || key.includes("website") || key.includes("url") || key.includes("image") ? 45 : 28),
  }));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
  header.commit();
  for (const row of rows) {
    const out = {};
    for (const column of columns) out[column] = row[column] === undefined || row[column] === null ? "" : row[column];
    worksheet.addRow(out).commit();
  }
  worksheet.commit();
}

async function main() {
  const files = fs.readdirSync(DOWNLOADS).filter((file) => file.toLowerCase().endsWith(".xlsx")).sort();
  for (const file of files) {
    processWorkbook(file);
  }

  const { canonical, duplicateRows } = buildCanonical();
  const split = splitByProfile(canonical);
  const sourceCount = new Set(inventory.map((row) => row.source_file)).size;
  const summary = {
    generated_at: new Date().toISOString(),
    local_sources_scanned: sourceCount,
    source_tabs_scanned: inventory.length,
    raw_records_normalized: records.length,
    canonical_profile_seeds: canonical.length,
    restaurants_food_trucks_bars: split.food.length,
    hosts: split.host.length,
    contractors: split.contractor.length,
    profile_seeds_with_image_links: canonical.filter((row) => clean(row.image_links)).length,
    restaurant_food_bar_rows_with_image_links: split.food.filter((row) => clean(row.image_links)).length,
    host_rows_with_image_links: split.host.filter((row) => clean(row.image_links)).length,
    contractor_rows_with_image_links: split.contractor.filter((row) => clean(row.image_links)).length,
    duplicate_group_member_rows: duplicateRows.length,
    needs_review_rows: reviewRows.length,
    screenshot_processing_files_excluded: EXCLUDED_SCREENSHOTS.length,
    inventory_only_sources: REMOTE_INVENTORY_ONLY.length,
    workbook: "Generated XLSX; imported as native Google Sheet",
    build_id: crypto.createHash("sha1").update(`${records.length}:${canonical.length}:${Date.now()}`).digest("hex").slice(0, 10),
  };
  await writeWorkbook(summary, split, duplicateRows);
  fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
