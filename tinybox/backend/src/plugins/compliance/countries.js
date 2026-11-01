'use strict';
/**
 * Reference data for geo-restrictions.
 *
 * References:
 *  - ISO 3166-1 alpha-2 country codes: https://www.iso.org/iso-3166-country-codes.html
 *    (list cross-checked against https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
 *  - Cloudflare CF-IPCountry header (alpha-2, "XX" = unknown, "T1" = Tor):
 *    https://developers.cloudflare.com/fundamentals/reference/http-headers/
 *  - OFAC comprehensive sanctions programs (Cuba, Iran, North Korea, Syria, and the
 *    Crimea / DNR / LNR regions of Ukraine, which have no ISO code):
 *    https://ofac.treasury.gov/sanctions-programs-and-country-information
 *  - FATF "High-Risk Jurisdictions subject to a Call for Action" (DPRK, Iran, Myanmar):
 *    https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html
 *  - Retail crypto-derivatives restrictions (default DERIVATIVES_RESTRICTED list):
 *      US  CFTC: offering leveraged retail commodity transactions / futures to US persons
 *          requires registration (Commodity Exchange Act §2(c)(2)(D)); https://www.cftc.gov
 *      GB  FCA PS20/10 "Prohibiting the sale to retail clients of investment products that
 *          reference cryptoassets" (in force 6 Jan 2021): https://www.fca.org.uk/publications/policy-statements/ps20-10-prohibiting-sale-retail-clients-investment-products-reference-cryptoassets
 *      CA  CSA Staff Notice 21-329 / 21-327: crypto contracts are securities/derivatives and
 *          need a registered dealer; https://www.securities-administrators.ca
 *      JP  FSA: crypto derivatives need FIEA Type I registration, leverage capped at 2x;
 *          https://www.fsa.go.jp/en/
 *      HK  SFC: licensed VATPs may not offer derivatives to retail; https://www.sfc.hk
 *      SG  MAS PS Act / SFA: unlicensed derivatives on payment tokens not permitted;
 *          https://www.mas.gov.sg
 *      KR  Virtual Asset User Protection Act (2024) – no retail crypto derivatives;
 *      CN  PBOC notice of 24 Sep 2021 – all crypto trading services illegal;
 *      BE  FSMA regulation of 26 May 2016 banning OTC leveraged products to retail;
 *      AU  ASIC Product Intervention Order 2020/986 – crypto CFD leverage capped at 2:1,
 *          and unlicensed offshore providers may not serve Australian retail clients.
 *    EU/EEA: ESMA/MiFID II product intervention caps crypto CFD leverage at 2:1 (not a ban),
 *    so EU countries are NOT in the default list; MiCA (Reg. (EU) 2023/1114) governs CASPs.
 *
 *  These defaults are a starting point, not legal advice. Admins can override any country
 *  from the Compliance admin tab (compliance_country_rules).
 */

const COUNTRIES = {
  AD: 'Andorra', AE: 'United Arab Emirates', AF: 'Afghanistan', AG: 'Antigua and Barbuda', AI: 'Anguilla', AL: 'Albania', AM: 'Armenia',
  AO: 'Angola', AQ: 'Antarctica', AR: 'Argentina', AS: 'American Samoa', AT: 'Austria', AU: 'Australia', AW: 'Aruba', AX: 'Åland Islands',
  AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina', BB: 'Barbados', BD: 'Bangladesh', BE: 'Belgium', BF: 'Burkina Faso', BG: 'Bulgaria',
  BH: 'Bahrain', BI: 'Burundi', BJ: 'Benin', BL: 'Saint Barthélemy', BM: 'Bermuda', BN: 'Brunei Darussalam', BO: 'Bolivia',
  BQ: 'Bonaire, Sint Eustatius and Saba', BR: 'Brazil', BS: 'Bahamas', BT: 'Bhutan', BV: 'Bouvet Island', BW: 'Botswana', BY: 'Belarus',
  BZ: 'Belize', CA: 'Canada', CC: 'Cocos (Keeling) Islands', CD: 'Congo, Democratic Republic of the', CF: 'Central African Republic',
  CG: 'Congo', CH: 'Switzerland', CI: "Côte d'Ivoire", CK: 'Cook Islands', CL: 'Chile', CM: 'Cameroon', CN: 'China', CO: 'Colombia',
  CR: 'Costa Rica', CU: 'Cuba', CV: 'Cabo Verde', CW: 'Curaçao', CX: 'Christmas Island', CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany',
  DJ: 'Djibouti', DK: 'Denmark', DM: 'Dominica', DO: 'Dominican Republic', DZ: 'Algeria', EC: 'Ecuador', EE: 'Estonia', EG: 'Egypt',
  EH: 'Western Sahara', ER: 'Eritrea', ES: 'Spain', ET: 'Ethiopia', FI: 'Finland', FJ: 'Fiji', FK: 'Falkland Islands (Malvinas)',
  FM: 'Micronesia', FO: 'Faroe Islands', FR: 'France', GA: 'Gabon', GB: 'United Kingdom', GD: 'Grenada', GE: 'Georgia', GF: 'French Guiana',
  GG: 'Guernsey', GH: 'Ghana', GI: 'Gibraltar', GL: 'Greenland', GM: 'Gambia', GN: 'Guinea', GP: 'Guadeloupe', GQ: 'Equatorial Guinea',
  GR: 'Greece', GS: 'South Georgia and the South Sandwich Islands', GT: 'Guatemala', GU: 'Guam', GW: 'Guinea-Bissau', GY: 'Guyana',
  HK: 'Hong Kong', HM: 'Heard Island and McDonald Islands', HN: 'Honduras', HR: 'Croatia', HT: 'Haiti', HU: 'Hungary', ID: 'Indonesia',
  IE: 'Ireland', IL: 'Israel', IM: 'Isle of Man', IN: 'India', IO: 'British Indian Ocean Territory', IQ: 'Iraq', IR: 'Iran', IS: 'Iceland',
  IT: 'Italy', JE: 'Jersey', JM: 'Jamaica', JO: 'Jordan', JP: 'Japan', KE: 'Kenya', KG: 'Kyrgyzstan', KH: 'Cambodia', KI: 'Kiribati',
  KM: 'Comoros', KN: 'Saint Kitts and Nevis', KP: 'North Korea', KR: 'South Korea', KW: 'Kuwait', KY: 'Cayman Islands', KZ: 'Kazakhstan',
  LA: 'Laos', LB: 'Lebanon', LC: 'Saint Lucia', LI: 'Liechtenstein', LK: 'Sri Lanka', LR: 'Liberia', LS: 'Lesotho', LT: 'Lithuania',
  LU: 'Luxembourg', LV: 'Latvia', LY: 'Libya', MA: 'Morocco', MC: 'Monaco', MD: 'Moldova', ME: 'Montenegro', MF: 'Saint Martin (French part)',
  MG: 'Madagascar', MH: 'Marshall Islands', MK: 'North Macedonia', ML: 'Mali', MM: 'Myanmar', MN: 'Mongolia', MO: 'Macao',
  MP: 'Northern Mariana Islands', MQ: 'Martinique', MR: 'Mauritania', MS: 'Montserrat', MT: 'Malta', MU: 'Mauritius', MV: 'Maldives',
  MW: 'Malawi', MX: 'Mexico', MY: 'Malaysia', MZ: 'Mozambique', NA: 'Namibia', NC: 'New Caledonia', NE: 'Niger', NF: 'Norfolk Island',
  NG: 'Nigeria', NI: 'Nicaragua', NL: 'Netherlands', NO: 'Norway', NP: 'Nepal', NR: 'Nauru', NU: 'Niue', NZ: 'New Zealand', OM: 'Oman',
  PA: 'Panama', PE: 'Peru', PF: 'French Polynesia', PG: 'Papua New Guinea', PH: 'Philippines', PK: 'Pakistan', PL: 'Poland',
  PM: 'Saint Pierre and Miquelon', PN: 'Pitcairn', PR: 'Puerto Rico', PS: 'Palestine, State of', PT: 'Portugal', PW: 'Palau', PY: 'Paraguay',
  QA: 'Qatar', RE: 'Réunion', RO: 'Romania', RS: 'Serbia', RU: 'Russian Federation', RW: 'Rwanda', SA: 'Saudi Arabia', SB: 'Solomon Islands',
  SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden', SG: 'Singapore', SH: 'Saint Helena, Ascension and Tristan da Cunha', SI: 'Slovenia',
  SJ: 'Svalbard and Jan Mayen', SK: 'Slovakia', SL: 'Sierra Leone', SM: 'San Marino', SN: 'Senegal', SO: 'Somalia', SR: 'Suriname',
  SS: 'South Sudan', ST: 'Sao Tome and Principe', SV: 'El Salvador', SX: 'Sint Maarten (Dutch part)', SY: 'Syria', SZ: 'Eswatini',
  TC: 'Turks and Caicos Islands', TD: 'Chad', TF: 'French Southern Territories', TG: 'Togo', TH: 'Thailand', TJ: 'Tajikistan', TK: 'Tokelau',
  TL: 'Timor-Leste', TM: 'Turkmenistan', TN: 'Tunisia', TO: 'Tonga', TR: 'Türkiye', TT: 'Trinidad and Tobago', TV: 'Tuvalu', TW: 'Taiwan',
  TZ: 'Tanzania', UA: 'Ukraine', UG: 'Uganda', UM: 'United States Minor Outlying Islands', US: 'United States', UY: 'Uruguay',
  UZ: 'Uzbekistan', VA: 'Holy See', VC: 'Saint Vincent and the Grenadines', VE: 'Venezuela', VG: 'Virgin Islands (British)',
  VI: 'Virgin Islands (U.S.)', VN: 'Viet Nam', VU: 'Vanuatu', WF: 'Wallis and Futuna', WS: 'Samoa', YE: 'Yemen', YT: 'Mayotte',
  ZA: 'South Africa', ZM: 'Zambia', ZW: 'Zimbabwe',
};

/** Comprehensive-embargo countries: no signup, trading or withdrawals at all. */
const DEFAULT_SANCTIONED = ['CU', 'IR', 'KP', 'SY'];

/** Countries where leveraged crypto derivatives may not be offered to retail clients (see header). */
const DEFAULT_DERIVATIVES_RESTRICTED = ['US', 'GB', 'CA', 'JP', 'HK', 'SG', 'KR', 'CN', 'BE', 'AU'];

const CODE_RE = /^[A-Z]{2}$/;
/** Normalise a user/header-supplied value to a known alpha-2 code, or null. */
function normalizeCountry(v) {
  const c = String(v || '').trim().toUpperCase();
  return CODE_RE.test(c) && COUNTRIES[c] ? c : null;
}
function countryName(code) { return COUNTRIES[code] || code || 'Unknown'; }

module.exports = { COUNTRIES, DEFAULT_SANCTIONED, DEFAULT_DERIVATIVES_RESTRICTED, normalizeCountry, countryName };
