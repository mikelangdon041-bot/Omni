// Field catalog for the AI-assisted KOL importer. The importer can target any
// of these; special keys (__name__, __city__, __state__, __zip__) post-process
// into first/last name and a combined address.

export const SPECIAL_NAME = "__name__";
export const IGNORE = "__ignore__";
export const CITY = "__city__";
export const STATE = "__state__";
export const ZIP = "__zip__";
export const LOCATION_PARTS = new Set(["address", CITY, STATE, ZIP]);

export interface ProfileField {
  key: string;
  label: string;
  hint?: string;
}

export const PROFILE_FIELDS: ProfileField[] = [
  { key: SPECIAL_NAME, label: "Full Name (split into First / Last)", hint: 'one column holding the whole name, e.g. "Smith, Jane" or "Jane Smith"' },
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "specialty", label: "Specialty", hint: "medical specialty" },
  { key: "title_position", label: "Title / Position", hint: "job title or academic rank" },
  { key: "institution", label: "Institution", hint: "hospital, clinic, university or practice name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address (full / street)", hint: "a full or street address in one column" },
  { key: CITY, label: "City", hint: "city / town only — combined into the address" },
  { key: STATE, label: "State / Region", hint: "state or region — combined into the address" },
  { key: ZIP, label: "Zip / Postal Code", hint: "postal code — combined into the address" },
  { key: "society_associations", label: "Society / Associations" },
  { key: "leadership_appointments", label: "Leadership Appointments" },
  { key: "publications", label: "Publications" },
  { key: "areas_of_interest", label: "Areas of Interest" },
  { key: "potential_collaborations", label: "Potential Collaborations" },
  { key: "website_office", label: "Office Website" },
  { key: "website_pubmed", label: "PubMed" },
  { key: "website_other", label: "Other Website / Link" },
  { key: "tier", label: "Tier", hint: "a ranking/tier value, e.g. 1/2/3 or A/B/C" },
  { key: "is_product_a_user", label: "Product A User (yes/no)" },
  { key: "is_product_b_user", label: "Product B User (yes/no)" },
  { key: "notes", label: "Notes / Other Info" },
  { key: IGNORE, label: "— Ignore this column —" },
];

export const BOOLEAN_FIELDS = new Set(["is_product_a_user", "is_product_b_user"]);

export function fieldGuideForPrompt(): string {
  return PROFILE_FIELDS.filter((f) => f.key !== IGNORE)
    .map((f) => `- ${f.key}: ${f.label}${f.hint ? ` (${f.hint})` : ""}`)
    .join("\n");
}

export function isValidField(key: unknown): boolean {
  return key === IGNORE || PROFILE_FIELDS.some((f) => f.key === key);
}
