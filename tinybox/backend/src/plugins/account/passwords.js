'use strict';
/**
 * Password policy.
 *
 *   OWASP Authentication Cheat Sheet   https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
 *   NIST SP 800-63B §5.1.1             https://pages.nist.gov/800-63-3/sp800-63b.html
 *   Common passwords: top entries of the SecLists / "10k most common" corpus
 *                                      https://github.com/danielmiessler/SecLists/tree/master/Passwords/Common-Credentials
 *
 * Following NIST/OWASP there are no composition rules (no "one uppercase, one
 * symbol"): we require length, refuse the most common passwords and anything
 * derived from the user's own email, and allow long passphrases.
 */
const { HttpError } = require('../../provisioner');

const MAX_LENGTH = 128;

// ~200 most common passwords (lower-cased). Trailing digits/punctuation are stripped before matching, so
// "Password123!" or "qwerty2024" are caught too.
const COMMON_PASSWORDS = new Set(`
123456 password 12345678 qwerty 123456789 12345 1234 111111 1234567 dragon 123123 baseball abc123 football monkey
letmein shadow master 666666 qwertyuiop 123321 mustang 1234567890 michael 654321 superman 1qaz2wsx 7777777 121212
000000 qazwsx 123qwe killer trustno1 jordan jennifer zxcvbnm asdfgh hunter buster soccer harley batman andrew tigger
sunshine iloveyou 2000 charlie robert thomas hockey ranger daniel starwars klaster 112233 george computer michelle
jessica pepper 1111 zxcvbn 555555 11111111 131313 freedom 777777 pass maggie 159753 aaaaaa ginger princess joshua
cheese amanda summer love ashley nicole chelsea biteme matthew access yankees 987654321 dallas austin thunder taylor
matrix mobilemail mom monitor monitoring montana moon moscow password1 password123 passw0rd p@ssw0rd p@ssword admin
administrator root toor welcome welcome1 login guest default changeme secret test test123 testing qwerty123 qwerty1
abcd1234 abc12345 1q2w3e4r 1q2w3e4r5t 1q2w3e q1w2e3r4 zaq12wsx asdf asdfasdf asdf1234 asdfghjkl zxcvbnm123 letmein1
iloveyou1 whatever nothing hello hello123 hello1 flower pokemon pokemon1 naruto dragonball minecraft fortnite roblox
liverpool arsenal chelsea1 barcelona realmadrid juventus bailey cookie chocolate snoopy mickey jasmine hannah lauren
samantha anthony william jackson jordan23 cowboy cowboys eagles steelers lakers yankees1 corvette ferrari porsche
mercedes toyota honda nissan samsung iphone google facebook twitter instagram linkedin netflix spotify amazon paypal
bitcoin crypto binance coinbase ethereum blockchain trading wallet money money1 cash dollar rich richie internet
abcdef abcdefg abcdefgh 1234qwer 12341234 123123123 1234512345 1q2w3e4r5t6y 0123456789 9876543210 qwerty12345
password2 password12 password1234 pa55word pa55w0rd passwort passw0rd1 adminadmin admin123 admin1234 root123 user
user123 welcome123 letmein123 master1 killer1 shadow1 sunshine1 superman1 batman1 baseball1 football1 monkey1
dragon1 soccer1 hockey1 tigger1 charlie1 michael1 jennifer1 jordan1 hunter1 ginger1 cheese1 summer1 freedom1
starwars1 trustno1! tinybox nimbus platform exchange
`.split(/\s+/).filter(Boolean));

function normalise(p) { return String(p).toLowerCase().replace(/[\s]/g, ''); }

/** True when the password (or its stem without trailing digits/punctuation) is on the common list. */
function isCommon(password) {
  const n = normalise(password);
  if (COMMON_PASSWORDS.has(n)) return true;
  const stem = n.replace(/[0-9!@#$%^&*.,_-]+$/, '');
  if (stem.length >= 4 && COMMON_PASSWORDS.has(stem)) return true;
  // "Password2024" -> leet/trivial variants
  const deleet = stem.replace(/@/g, 'a').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/\$/g, 's');
  return deleet.length >= 4 && COMMON_PASSWORDS.has(deleet);
}

/**
 * Validate a new password. policy: 'strict' (default) | 'legacy' (length >= 8 only, kept for installations
 * that still have to accept the pre-upgrade rules). Throws HttpError(400, ..., { code: 'WEAK_PASSWORD' }).
 */
function checkPassword(password, { email = '', policy = 'strict', minLength = 10 } = {}) {
  const bad = (msg, reason) => new HttpError(400, msg, { code: 'WEAK_PASSWORD', data: { reason } });
  if (typeof password !== 'string') throw bad('Enter a password', 'missing');
  if (password.length > MAX_LENGTH) throw bad(`Password must be at most ${MAX_LENGTH} characters`, 'too_long');
  const min = policy === 'legacy' ? 8 : Math.max(8, Number(minLength) || 10);
  if (password.length < min) throw bad(`Password must be at least ${min} characters`, 'too_short');
  const e = String(email || '').toLowerCase();
  const n = password.toLowerCase();
  if (e && (n === e || n === e.split('@')[0] || (e.split('@')[0].length >= 4 && n.includes(e.split('@')[0])))) throw bad('Password must not contain your email address', 'contains_email');
  if (policy === 'legacy') return true;
  if (/^(.)\1+$/.test(password)) throw bad('Password is too repetitive', 'repetitive');
  if (isCommon(password)) throw bad('That password is too common. Pick something harder to guess.', 'common');
  return true;
}

module.exports = { checkPassword, isCommon, COMMON_PASSWORDS, MAX_LENGTH };
