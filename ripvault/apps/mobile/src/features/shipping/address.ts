/**
 * Address form model + client-side validation (mirrors the API rules in apps/api shipping service:
 * lengths, postcode/phone patterns, country in config.shipping.countries), plus display helpers.
 */
import type { AddressInput } from '@ripvault/shared';

const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  GB: 'United Kingdom',
  IE: 'Ireland',
  JE: 'Jersey',
  GG: 'Guernsey',
  IM: 'Isle of Man',
  US: 'United States',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  FR: 'France',
  DE: 'Germany',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  BE: 'Belgium',
};

export function countryName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/** "United Kingdom" / "United Kingdom and Ireland" / "A, B and C". */
export function countryList(codes: readonly string[]): string {
  const names = codes.map(countryName);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Postcodes & phone

const UK_POSTCODE = /^(GIR ?0AA|[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2})$/i;
const GENERIC_POSTCODE = /^[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]$/;
const PHONE = /^\+?[0-9 ()-]{6,20}$/;

/** Basic UK postcode check ("SW1A 1AA", "sw1a1aa", "M1 1AE"). */
export function isUkPostcode(value: string): boolean {
  return UK_POSTCODE.test(value.trim().replace(/\s+/g, ' '));
}

/** Upper-case and, for UK postcodes, put the single space before the inward code: "sw1a1aa" -> "SW1A 1AA". */
export function normalisePostcode(value: string, country: string): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (country.toUpperCase() === 'GB') {
    const bare = compact.replace(/\s/g, '');
    if (bare.length >= 5) return `${bare.slice(0, -3)} ${bare.slice(-3)}`;
  }
  return compact;
}

// ---------------------------------------------------------------------------
// Form

export interface AddressFormValues {
  fullName: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  phone: string;
}

export type AddressField = keyof AddressFormValues;
export type AddressErrors = Partial<Record<AddressField, string>>;

export function emptyAddressForm(country: string): AddressFormValues {
  return { fullName: '', line1: '', line2: '', city: '', region: '', postcode: '', country, phone: '' };
}

export const ADDRESS_LIMITS: Readonly<Record<AddressField, number>> = {
  fullName: 100,
  line1: 200,
  line2: 200,
  city: 100,
  region: 100,
  postcode: 12,
  country: 2,
  phone: 20,
};

const optional = (value: string): string | null => {
  const t = value.trim();
  return t === '' ? null : t;
};

/** Validate the form. Returns the API body when valid, otherwise per-field messages. */
export function validateAddress(
  values: AddressFormValues,
  allowedCountries: readonly string[],
): { input: AddressInput; errors: null } | { input: null; errors: AddressErrors } {
  const errors: AddressErrors = {};
  const country = values.country.trim().toUpperCase();
  const fullName = values.fullName.trim();
  const line1 = values.line1.trim();
  const city = values.city.trim();
  const postcode = normalisePostcode(values.postcode, country);
  const phone = optional(values.phone);

  if (!fullName) errors.fullName = 'Enter the name of the person receiving the parcel';
  else if (fullName.length > ADDRESS_LIMITS.fullName) errors.fullName = 'Name is too long';

  if (!line1) errors.line1 = 'Enter the first line of the address';
  else if (line1.length > ADDRESS_LIMITS.line1) errors.line1 = 'Address line 1 is too long';

  if (values.line2.trim().length > ADDRESS_LIMITS.line2) errors.line2 = 'Address line 2 is too long';

  if (!city) errors.city = 'Enter a town or city';
  else if (city.length > ADDRESS_LIMITS.city) errors.city = 'Town or city is too long';

  if (values.region.trim().length > ADDRESS_LIMITS.region) errors.region = 'County or region is too long';

  if (!postcode) errors.postcode = 'Enter a postcode';
  else if (country === 'GB' ? !isUkPostcode(postcode) : !GENERIC_POSTCODE.test(postcode) || postcode.length > ADDRESS_LIMITS.postcode)
    errors.postcode = country === 'GB' ? 'Enter a valid UK postcode, e.g. SW1A 1AA' : 'Enter a valid postcode';

  if (!/^[A-Z]{2}$/.test(country)) errors.country = 'Choose a country';
  else if (allowedCountries.length > 0 && !allowedCountries.includes(country))
    errors.country = `We currently ship to ${countryList(allowedCountries)} only`;

  if (phone !== null && !PHONE.test(phone)) errors.phone = 'Enter a valid phone number, e.g. 07700 900123';

  if (Object.keys(errors).length > 0) return { input: null, errors };
  return {
    input: {
      fullName,
      line1,
      line2: optional(values.line2),
      city,
      region: optional(values.region),
      postcode,
      country,
      phone,
    },
    errors: null,
  };
}

/** Lines for display: name, street lines, "City, Region", "POSTCODE", country. */
export function addressLines(address: AddressInput): string[] {
  const cityLine = [address.city, address.region].filter(Boolean).join(', ');
  return [address.line1, address.line2 ?? '', cityLine, address.postcode, countryName(address.country)].filter(
    (l) => l.trim() !== '',
  );
}

/** One line for compact rows / accessibility: "12 High St, London, SW1A 1AA". */
export function addressSummary(address: AddressInput): string {
  return [address.line1, address.line2, address.city, address.postcode].filter(Boolean).join(', ');
}
