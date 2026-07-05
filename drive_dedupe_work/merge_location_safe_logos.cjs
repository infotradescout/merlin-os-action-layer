/*
 * merge_location_safe_logos.cjs
 * ------------------------------------------------------------------
 * Purpose:
 *   Attach business logos / image links from the "Location Safe" workbook
 *   onto the existing deduped Business Lists Master, using a STRICT
 *   logo-safety gate. A logo is only trusted when it clearly belongs to
 *   the matched business. Anything questionable falls back to a
 *   placeholder instead of guessing.
 *
 * Safety model ("correct logo, or placeholder"):
 *   - Only exact/near-exact normalized business-name matches keep a logo.
 *   - Generic / social / non-image URLs are rejected.
 *   - Ambiguous names (same normalized name on multiple master rows) -> placeholder.
 *   - Phone conflict between Location Safe row and master row -> placeholder.
 *   - Existing master image_links are preserved (never overwritten by a guess).
 *   - Every output row always gets a logo_url: verified, existing, or placeholder.
 *     The website can read logo_url directly and will never show a wrong logo.
 *
 * This script NEVER edits the original master workbook or the source files.
 * It writes a brand-new "Logo Verified" workbook plus JSON + text reports.
 *
 * Usage:
 *   node merge_location_safe_logos.cjs                 (auto-detect Location Safe in downloads/)
 *   node merge_location_safe_logos.cjs --file "My Location Safe.xlsx"
 *   node merge_location_safe_logos.cjs --placeholder-only   (no Location Safe yet; just show structure)
 *   LOGO_PLACEHOLDER="/assets/logo-placeholder.svg" node merge_location_safe_logos.cjs
 */

const fs = require("fs");
const path = require("path");

const XLSX = require(path.join(__dirname, "parser", "node_modules", "xlsx"));
const ExcelJS = require(path.join(__dirname, "parser", "node_modules", "exceljs"));

const ROOT = __dirname;
const DOWNLOADS = path.join(ROOT, "downloads");
const MASTER_XLSX = path.join(ROOT, "Business Lists Master - Profile Seeds - Deduped - 2026-07-05.xlsx");
const OUT_XLSX = path.join(ROOT, "Business Lists Master - Profile Seeds - Logo Verified - 2026-07-05.xlsx");
const OUT_REPORT_JSON = path.join(ROOT, "logo_verification_report.json");
const OUT_REPORT_TXT = path.join(ROOT, "logo_verification_report.txt");

// Placeholder used whenever we are not fully confident about a logo.
const PLACEHOLDER_LOGO = process.env.LOGO_PLACEHOLDER || "/assets/placeholders/business-logo-placeholder.svg";

const SEED_SHEETS = ["Restaurants-Food-Bars", "Hosts", "Contractors"];

// Column order carried over from build_business_master.cjs, plus logo columns.
const SEED_COLUMNS = [
  "seed_id", "business_name", "business_category", "sub_category", "license_number", "status",
  "phone", "email", "website", "facebook", "instagram", "image_links", "address", "city", "county", "state",
  "zip", "contact_name", "source_count", "sources", "merge_group_id", "match_confidence", "notes",
];
const LOGO_COLUMNS = ["logo_url", "logo_source", "logo_confidence", "logo_reason"];
const OUT_SEED_COLUMNS = [...SEED_COLUMNS, ...LOGO_COLUMNS];

// ---- Aliases (kept in sync with build_business_master.cjs) ----
const NAME_ALIASES = ["business", "business_name", "businessname", "company_name", "company", "name", "food_truck_name", "truck_name", "host_name", "restaurant_name", "vendor_name"];
const PHONE_ALIASES = ["phone", "phones", "number", "contact_phone", "contact_details"];
const IMAGE_ALIASES = [
  "image", "images", "image_url", "image_urls", "image_link", "image_links",
  "photo", "photos", "photo_url", "photo_urls", "picture", "pictures",
  "logo", "logo_url", "logo_link", "logo_links", "featured_image", "featured image", "thumbnail",
  "media", "media_url", "media_urls", "asset", "attachment", "attachments",
  "gallery", "business_image", "business_photo", "profile_image", "cover", "cover_image",
];

// Domains that are never trusted as a real business logo/image.
const GENERIC_DOMAINS = new Set([
  "facebook.com", "m.facebook.com", "instagram.com", "google.com", "www.google.com",
  "maps.google.com", "search.google.com", "goo.gl", "yelp.com", "linkedin.com",
  "x.com", "twitter.com", "tiktok.com", "youtube.com", "youtu.be",
  "myfloridalicense.custhelp.com",
]);

// Hosts / paths we accept as real image URLs even without a file extension.
const IMAGE_HOSTS = [
  "googleusercontent.com", "lh3.googleusercontent.com", "lh4.googleusercontent.com",
  "lh5.googleusercontent.com", "lh6.googleusercontent.com", "drive.google.com",
  "cloudinary.com", "res.cloudinary.com", "imgix.net", "imgur.com", "i.imgur.com",
  "amazonaws.com", "cdn.shopify.com", "squarespace-cdn.com", "wixstatic.com",
];
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)(\?|#|$)/i;

// ---- Text helpers (verbatim behavior from build_business_master.cjs) ----
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

function normalizeName(name) {
  let text = clean(name).toLowerCase();
  text = text.replace(/&/g, " and ");
  text = text.replace(/['".,/#()\-]/g, " ");
  text = text.replace(/\b(dba|d b a|llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|pa|p a|pllc|p l l c)\b/g, " ");
  text = text.replace(/\b(the|and)\b/g, " ");
  return text.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function phoneKey(value) {
  return clean(value).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

function normalizeUrl(value) {
  let text = clean(value);
  if (!text) return "";
  if (text.startsWith("@")) return "";
  if (text.includes("@") && !/^https?:\/\//i.test(text)) return "";
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
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Classify a single URL. Returns { ok, reason }.
function classifyImageUrl(url) {
  const norm = normalizeUrl(url);
  if (!norm) return { ok: false, reason: "not_a_url" };
  const domain = domainOf(norm);
  if (!domain) return { ok: false, reason: "no_domain" };
  if (GENERIC_DOMAINS.has(domain)) return { ok: false, reason: "generic_or_social_domain" };
  const hostAllowed = IMAGE_HOSTS.some((h) => domain === h || domain.endsWith(`.${h}`));
  const looksLikeImageFile = IMAGE_EXT_RE.test(norm);
  if (looksLikeImageFile || hostAllowed) return { ok: true, reason: "" };
  return { ok: false, reason: "not_recognized_as_image" };
}

// ---- Location Safe parsing ----
function findLocationSafeFile(explicit) {
  if (explicit) {
    const full = path.isAbsolute(explicit) ? explicit : path.join(DOWNLOADS, explicit);
    return fs.existsSync(full) ? full : null;
  }
  if (!fs.existsSync(DOWNLOADS)) return null;
  const candidates = fs.readdirSync(DOWNLOADS)
    .filter((f) => f.toLowerCase().endsWith(".xlsx"))
    .filter((f) => /location.?safe/i.test(f));
  return candidates.length ? path.join(DOWNLOADS, candidates[0]) : null;
}

function detectHeaderRow(rows) {
  const nameKeys = new Set(NAME_ALIASES.map(hnorm));
  const imageKeys = new Set(IMAGE_ALIASES.map(hnorm));
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const keys = rows[i].map(hnorm);
    const hasName = keys.some((k) => nameKeys.has(k));
    const hasImage = keys.some((k) => imageKeys.has(k) || k.includes("image") || k.includes("logo") || k.includes("photo"));
    if (hasName && hasImage) return i;
  }
  // Fall back to a row that at least has a name column.
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].map(hnorm).some((k) => nameKeys.has(k))) return i;
  }
  return -1;
}

function columnIndexes(headerRow, aliases) {
  const wanted = new Set(aliases.map(hnorm));
  const idx = [];
  headerRow.forEach((cell, i) => {
    const key = hnorm(cell);
    if (wanted.has(key)) idx.push(i);
  });
  return idx;
}

function imageColumnIndexes(headerRow) {
  const idx = new Set(columnIndexes(headerRow, IMAGE_ALIASES));
  headerRow.forEach((cell, i) => {
    const key = hnorm(cell);
    if (key.includes("image") || key.includes("logo") || key.includes("photo") || key.includes("picture") || key.includes("media") || key.includes("gallery")) {
      idx.add(i);
    }
  });
  return [...idx];
}

function loadLocationSafe(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const out = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
    if (!rows.length) continue;
    const headerIdx = detectHeaderRow(rows);
    if (headerIdx < 0) continue;
    const header = rows[headerIdx];
    const nameCols = columnIndexes(header, NAME_ALIASES);
    const phoneCols = columnIndexes(header, PHONE_ALIASES);
    const imageCols = imageColumnIndexes(header);
    if (!nameCols.length || !imageCols.length) continue;
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const name = nameCols.map((c) => clean(row[c])).find(Boolean) || "";
      if (!name) continue;
      const phone = phoneCols.map((c) => clean(row[c])).find(Boolean) || "";
      const imageRaw = imageCols.map((c) => clean(row[c])).filter(Boolean).join(" ");
      const links = extractLinks(imageRaw);
      if (!links.length) continue;
      out.push({
        sheet: sheetName,
        source_row: r + 1,
        name,
        normalized_name: normalizeName(name),
        phone_key: phoneKey(phone),
        links,
      });
    }
  }
  return out;
}

// ---- Master parsing ----
function loadMaster() {
  const wb = XLSX.readFile(MASTER_XLSX, { cellDates: false });
  const sheets = {};
  for (const name of SEED_SHEETS) {
    const sheet = wb.Sheets[name];
    if (!sheet) {
      sheets[name] = [];
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    sheets[name] = rows.map((row) => {
      const out = {};
      for (const col of SEED_COLUMNS) out[col] = clean(row[col]);
      out.normalized_name = normalizeName(out.business_name);
      out.phone_key = phoneKey(out.phone);
      return out;
    });
  }
  return sheets;
}

// ---- Core merge ----
function run() {
  const args = process.argv.slice(2);
  const explicitFile = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;
  const placeholderOnly = args.includes("--placeholder-only");

  if (!fs.existsSync(MASTER_XLSX)) {
    console.error(`Master workbook not found:\n  ${MASTER_XLSX}`);
    process.exitCode = 2;
    return;
  }

  const master = loadMaster();
  const allRows = SEED_SHEETS.flatMap((s) => master[s]);

  // Index master rows by normalized name to detect exact matches and ambiguity.
  const byName = new Map();
  for (const row of allRows) {
    if (!row.normalized_name) continue;
    if (!byName.has(row.normalized_name)) byName.set(row.normalized_name, []);
    byName.get(row.normalized_name).push(row);
  }

  let locationSafeRows = [];
  let locationSafePath = null;
  if (!placeholderOnly) {
    locationSafePath = findLocationSafeFile(explicitFile);
    if (!locationSafePath) {
      console.error([
        "Location Safe workbook not found.",
        "",
        "Put the file in this folder (name must contain 'Location Safe'):",
        `  ${DOWNLOADS}`,
        "",
        "Then re-run:  node merge_location_safe_logos.cjs",
        "Or point at it directly:  node merge_location_safe_logos.cjs --file \"<filename>.xlsx\"",
        "Or preview placeholder output now:  node merge_location_safe_logos.cjs --placeholder-only",
      ].join("\n"));
      process.exitCode = 3;
      return;
    }
    locationSafeRows = loadLocationSafe(locationSafePath);
  }

  const decisions = [];
  const rejected = [];

  // Build verified logo assignments (strict gate).
  // verifiedByRow: master row -> { url, confidence, reason }
  const verifiedByRow = new Map();
  for (const ls of locationSafeRows) {
    const validUrls = [];
    for (const url of ls.links) {
      const check = classifyImageUrl(url);
      if (check.ok) validUrls.push(normalizeUrl(url));
      else rejected.push({ business_name: ls.name, url, reason: check.reason, source_row: ls.source_row });
    }
    if (!validUrls.length) continue;

    if (!ls.normalized_name) continue;
    const matches = byName.get(ls.normalized_name) || [];
    const distinctSeeds = new Set(matches.map((m) => m.seed_id));

    if (matches.length === 0) {
      decisions.push({ business_name: ls.name, decision: "skipped_no_master_match", reason: "business_not_in_master", url: validUrls.join("; ") });
      continue;
    }
    if (distinctSeeds.size > 1) {
      // Ambiguous: same normalized name maps to multiple distinct master profiles.
      decisions.push({ business_name: ls.name, decision: "rejected_ambiguous", reason: "ambiguous_name_multiple_master_rows", url: validUrls.join("; "), match_count: matches.length });
      continue;
    }

    const target = matches[0];
    // Strict phone corroboration: if both have a phone and they differ, reject.
    let confidence = "medium_name_only";
    if (ls.phone_key && target.phone_key) {
      if (ls.phone_key === target.phone_key) confidence = "high_name_and_phone";
      else {
        decisions.push({ business_name: ls.name, decision: "rejected_phone_conflict", reason: "phone_conflict", url: validUrls.join("; "), master_seed_id: target.seed_id });
        continue;
      }
    }

    const url = validUrls.join("; ");
    const existing = verifiedByRow.get(target);
    if (!existing || (existing.confidence !== "high_name_and_phone" && confidence === "high_name_and_phone")) {
      verifiedByRow.set(target, { url, confidence, reason: confidence });
    }
    decisions.push({ business_name: ls.name, decision: "verified", reason: confidence, url, master_seed_id: target.seed_id });
  }

  // Apply logo columns to every master row.
  const stats = {
    generated_at: new Date().toISOString(),
    mode: placeholderOnly ? "placeholder_only_preview" : "merge_location_safe",
    location_safe_file: locationSafePath ? path.basename(locationSafePath) : null,
    placeholder_used: PLACEHOLDER_LOGO,
    master_rows_total: allRows.length,
    verified_from_location_safe: 0,
    kept_existing_master_image: 0,
    placeholdered: 0,
    rejected_image_urls: rejected.length,
    location_safe_rows_with_images: locationSafeRows.length,
  };

  for (const sheetName of SEED_SHEETS) {
    for (const row of master[sheetName]) {
      const verified = verifiedByRow.get(row);
      if (verified) {
        row.logo_url = verified.url;
        row.logo_source = "location_safe_verified";
        row.logo_confidence = verified.confidence;
        row.logo_reason = "matched_business_name" + (verified.confidence === "high_name_and_phone" ? "_and_phone" : "");
        stats.verified_from_location_safe++;
      } else if (row.image_links) {
        // Preserve an existing image already trusted in the master (e.g. contractors).
        row.logo_url = row.image_links;
        row.logo_source = "existing_master";
        row.logo_confidence = "existing";
        row.logo_reason = "preserved_existing_master_image_links";
        stats.kept_existing_master_image++;
      } else {
        row.logo_url = PLACEHOLDER_LOGO;
        row.logo_source = "placeholder";
        row.logo_confidence = "none";
        row.logo_reason = placeholderOnly ? "placeholder_only_preview" : "no_verified_logo_available";
        stats.placeholdered++;
      }
    }
  }

  return writeOutputs(master, stats, decisions, rejected);
}

async function writeRows(workbook, name, columns, rows) {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = columns.map((key) => ({
    header: key,
    key,
    width: Math.min(Math.max(key.length + 2, 12), key.includes("source") || key.includes("url") || key.includes("logo") || key.includes("image") ? 45 : 28),
  }));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
  header.commit();
  for (const row of rows) {
    const out = {};
    for (const col of columns) out[col] = row[col] === undefined || row[col] === null ? "" : row[col];
    worksheet.addRow(out).commit();
  }
  worksheet.commit();
}

async function writeOutputs(master, stats, decisions, rejected) {
  if (fs.existsSync(OUT_XLSX)) fs.rmSync(OUT_XLSX);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: OUT_XLSX, useStyles: true, useSharedStrings: false });
  workbook.creator = "merge_location_safe_logos";
  workbook.created = new Date();

  await writeRows(workbook, "README", ["section", "value"], [
    { section: "Purpose", value: "Business master with a verified logo_url column. Each row always has a logo_url: verified, existing, or placeholder." },
    { section: "Logo safety", value: "A logo is only trusted on an exact business-name match. Ambiguous names, phone conflicts, and non-image/social URLs fall back to the placeholder." },
    { section: "Placeholder", value: `Rows without a trusted logo use: ${stats.placeholder_used}` },
    { section: "Source of logos", value: `Location Safe file: ${stats.location_safe_file || "(none - placeholder-only preview)"}` },
    { section: "Original files", value: "The original master and source files were not edited. This is a new output workbook." },
  ]);

  await writeRows(workbook, "Restaurants-Food-Bars", OUT_SEED_COLUMNS, master["Restaurants-Food-Bars"]);
  await writeRows(workbook, "Hosts", OUT_SEED_COLUMNS, master["Hosts"]);
  await writeRows(workbook, "Contractors", OUT_SEED_COLUMNS, master["Contractors"]);

  await writeRows(workbook, "Logo Decisions", ["business_name", "decision", "reason", "confidence", "master_seed_id", "match_count", "url"],
    decisions.map((d) => ({
      business_name: d.business_name || "",
      decision: d.decision || "",
      reason: d.reason || "",
      confidence: d.confidence || "",
      master_seed_id: d.master_seed_id || "",
      match_count: d.match_count === undefined ? "" : d.match_count,
      url: d.url || "",
    })));

  await writeRows(workbook, "Rejected Image URLs", ["business_name", "url", "reason", "source_row"], rejected);

  await writeRows(workbook, "Logo Stats", ["metric", "value"], Object.entries(stats).map(([metric, value]) => ({ metric, value: String(value) })));

  await workbook.commit();

  fs.writeFileSync(OUT_REPORT_JSON, JSON.stringify({ stats, decisions, rejected }, null, 2));

  const lines = [];
  lines.push("Location Safe logo verification report");
  lines.push("");
  for (const [k, v] of Object.entries(stats)) lines.push(`${k}: ${v}`);
  lines.push("");
  lines.push("Decision counts:");
  const counts = {};
  for (const d of decisions) counts[d.decision] = (counts[d.decision] || 0) + 1;
  for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
  lines.push("");
  lines.push(`Output workbook: ${path.basename(OUT_XLSX)}`);
  lines.push(`JSON report: ${path.basename(OUT_REPORT_JSON)}`);
  fs.writeFileSync(OUT_REPORT_TXT, lines.join("\n") + "\n");

  console.log(JSON.stringify(stats, null, 2));
  console.log(`\nWrote:\n  ${OUT_XLSX}\n  ${OUT_REPORT_JSON}\n  ${OUT_REPORT_TXT}`);
}

Promise.resolve()
  .then(run)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
