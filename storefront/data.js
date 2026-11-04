/* Product catalogue. Prices are monthly (or yearly for domains/SSL) in GBP, ex. VAT. */
window.CATALOG = {
  vatRate: 0.2,

  tlds: [
    { tld: '.co.uk',  first: 0.99,  renew: 9.99,  tag: 'Popular' },
    { tld: '.com',    first: 4.99,  renew: 14.99, tag: 'Popular' },
    { tld: '.uk',     first: 0.99,  renew: 9.99 },
    { tld: '.org',    first: 7.99,  renew: 15.99 },
    { tld: '.net',    first: 9.99,  renew: 16.99 },
    { tld: '.io',     first: 34.99, renew: 44.99 },
    { tld: '.online', first: 1.99,  renew: 29.99, tag: 'Sale' },
    { tld: '.shop',   first: 2.99,  renew: 34.99, tag: 'Sale' },
    { tld: '.store',  first: 1.99,  renew: 39.99 },
    { tld: '.tech',   first: 4.99,  renew: 44.99 },
    { tld: '.london', first: 19.99, renew: 34.99 },
    { tld: '.dev',    first: 12.99, renew: 16.99 }
  ],

  hosting: [
    { id: 'host-starter',  name: 'Starter',  price: 1,    was: 4,  term: 'mo', features: ['1 website', '25 GB SSD storage', 'Free SSL', '1 email mailbox', 'Free .co.uk domain for 1 year'] },
    { id: 'host-plus',     name: 'Plus',     price: 4,    was: 8,  term: 'mo', popular: true, features: ['10 websites', '100 GB SSD storage', 'Free SSL', '10 email mailboxes', 'Daily backups', 'Free domain for 1 year'] },
    { id: 'host-ultimate', name: 'Ultimate', price: 8,    was: 14, term: 'mo', features: ['Unlimited websites', 'Unlimited SSD storage', 'Free wildcard SSL', 'Unlimited mailboxes', 'Daily backups + restore', 'Priority support'] }
  ],

  vps: [
    { id: 'vps-s',   name: 'VPS S',   price: 2,  was: 6,  term: 'mo', specs: { vCPU: 1, RAM: '1 GB',  Storage: '10 GB NVMe',  Traffic: 'Unlimited' } },
    { id: 'vps-m',   name: 'VPS M',   price: 6,  was: 10, term: 'mo', specs: { vCPU: 2, RAM: '4 GB',  Storage: '80 GB NVMe',  Traffic: 'Unlimited' }, popular: true },
    { id: 'vps-l',   name: 'VPS L',   price: 12, was: 18, term: 'mo', specs: { vCPU: 4, RAM: '8 GB',  Storage: '160 GB NVMe', Traffic: 'Unlimited' } },
    { id: 'vps-xl',  name: 'VPS XL',  price: 24, was: 32, term: 'mo', specs: { vCPU: 8, RAM: '16 GB', Storage: '320 GB NVMe', Traffic: 'Unlimited' } }
  ],
  vpsOs: ['Ubuntu 24.04', 'Debian 12', 'AlmaLinux 9', 'Rocky Linux 9', 'Windows Server 2022 (+£15/mo)'],
  vpsLocations: ['London, UK', 'Manchester, UK', 'Frankfurt, DE'],

  dedicated: [
    { id: 'ded-e',   name: 'Entry',       price: 59,  term: 'mo', specs: { CPU: '4-core Xeon E-2334', RAM: '32 GB ECC',  Storage: '2 × 1 TB NVMe' } },
    { id: 'ded-p',   name: 'Performance', price: 119, term: 'mo', popular: true, specs: { CPU: '8-core AMD EPYC 4344P', RAM: '64 GB ECC', Storage: '2 × 2 TB NVMe' } },
    { id: 'ded-x',   name: 'Enterprise',  price: 249, term: 'mo', specs: { CPU: '24-core AMD EPYC 9254', RAM: '256 GB ECC', Storage: '4 × 4 TB NVMe' } }
  ],

  email: [
    { id: 'mail-basic', name: 'Mail Basic',    price: 1,  term: 'mo', features: ['2 GB mailbox', 'Webmail + IMAP', 'Spam & virus filter'] },
    { id: 'mail-biz',   name: 'Mail Business', price: 3,  term: 'mo', popular: true, features: ['50 GB mailbox', 'Calendar & contacts', 'Mobile sync', 'Archiving'] },
    { id: 'mail-365',   name: 'Office Suite',  price: 9,  term: 'mo', features: ['1 TB cloud storage', 'Desktop office apps', 'Video meetings', '50 GB mailbox'] }
  ],

  ssl: [
    { id: 'ssl-dv',  name: 'Domain Validated',   price: 29,  term: 'yr', features: ['Issued in minutes', '1 domain', '£10k warranty'] },
    { id: 'ssl-wc',  name: 'Wildcard',           price: 89,  term: 'yr', popular: true, features: ['All subdomains', 'Issued in minutes', '£250k warranty'] },
    { id: 'ssl-ev',  name: 'Extended Validation', price: 149, term: 'yr', features: ['Full company vetting', '1 domain', '£1.5m warranty'] }
  ],

  addons: [
    { id: 'add-privacy', name: 'Domain privacy', price: 0, term: 'yr', note: 'Included free' },
    { id: 'add-backup',  name: 'Automated backups', price: 2, term: 'mo' },
    { id: 'add-mail',    name: 'Mail Basic mailbox', price: 1, term: 'mo' },
    { id: 'add-ssl',     name: 'DV SSL certificate', price: 29, term: 'yr' }
  ]
};
