export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

export const DEFAULT_TRUSTED_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.es",
  "hotmail.it",
  "outlook.com",
  "outlook.co.uk",
  "outlook.fr",
  "outlook.de",
  "live.com",
  "live.co.uk",
  "live.fr",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.es",
  "yahoo.it",
  "yahoo.ca",
  "ymail.com",
  "rocketmail.com",
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  "tuta.com",
  "tuta.io",
  "tutanota.com",
  "tutanota.de",
  "fastmail.com",
  "fastmail.fm",
  "hey.com",
  "aol.com",
  "zoho.com",
  "zohomail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "gmx.fr",
  "mail.com",
  "laposte.net",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "web.de",
  "t-online.de",
  "comcast.net",
  "verizon.net",
  "att.net",
  "btinternet.com",
  "sky.com",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "sharklasers.com",
  "grr.la",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "10minutemail.com",
  "10minutemail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "fakeinbox.com",
  "maildrop.cc",
  "mintemail.com",
  "mohmal.com",
  "emailondeck.com",
  "getairmail.com",
  "harakirimail.com",
  "mailnesia.com",
  "burnermail.io",
  "tempr.email",
  "discard.email",
  "inboxkitten.com",
  "moakt.com",
  "mytemp.email",
  "tempail.com",
]);

const WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "qwerty",
  "qwertyui",
  "qwertyuiop",
  "qwerty123",
  "admin",
  "admin123",
  "admin1234",
  "letmein",
  "welcome",
  "welcome1",
  "welcome123",
  "iloveyou",
  "sunshine",
  "football",
  "princess",
  "dragon12",
  "monkey12",
  "trustno1",
  "proteusflow",
  "camo1234",
  "12345678",
  "123456789",
  "1234567890",
  "00000000",
  "11111111",
  "aaaaaaaa",
]);

const WEAK_BASE_WORDS = new Set([
  "password",
  "passw0rd",
  "qwerty",
  "qwertyuiop",
  "admin",
  "letmein",
  "welcome",
  "iloveyou",
  "abcdef",
  "abcdefg",
  "abcdefgh",
  "proteusflow",
]);

const WEAK_SEQUENCES = [
  "01234",
  "12345",
  "23456",
  "34567",
  "45678",
  "56789",
  "98765",
  "87654",
  "76543",
  "65432",
  "54321",
  "43210",
  "abcdef",
  "fedcba",
  "qwerty",
  "asdfgh",
  "zxcvbn",
];

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

export function trustedEmailError(email: string, allowedDomains?: string[] | null): string | null {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned || cleaned.length > 320 || !EMAIL_PATTERN.test(cleaned)) {
    return "Enter a valid email address.";
  }
  const domain = cleaned.split("@").pop() || "";
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return "Temporary or disposable email addresses are not allowed. Use a trusted provider like Gmail, Hotmail, Outlook, iCloud, Yahoo, or Proton.";
  }
  const allowSet =
    allowedDomains && allowedDomains.length > 0
      ? new Set(allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))
      : DEFAULT_TRUSTED_EMAIL_DOMAINS;
  if (allowSet.size > 0 && !allowSet.has(domain)) {
    return "Use a trusted email provider like Gmail, Hotmail, Outlook, iCloud, Yahoo, or Proton.";
  }
  return null;
}

export interface PasswordAssessment {
  valid: boolean;
  error: string | null;
  level: "empty" | "weak" | "fair" | "strong";
  score: 0 | 1 | 2 | 3;
  label: string;
  hint: string;
  hasMinLength: boolean;
  classes: number;
}

export function assessPassword(password: string, email = ""): PasswordAssessment {
  const hasMinLength = password.length >= MIN_PASSWORD_LENGTH;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(password);
  const classes = Number(hasLower) + Number(hasUpper) + Number(hasDigit) + Number(hasSymbol);
  const uniqueChars = new Set(password).size;

  if (!password) {
    return {
      valid: false,
      error: "A password is required.",
      level: "empty",
      score: 0,
      label: "8+ chars",
      hint: "Mix uppercase, lowercase & numbers (e.g. Summer26) or a 12+ char phrase.",
      hasMinLength: false,
      classes: 0,
    };
  }
  if (!hasMinLength) {
    return {
      valid: false,
      error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      level: "weak",
      score: 1,
      label: "Too short",
      hint: `Add ${MIN_PASSWORD_LENGTH - password.length} more character${MIN_PASSWORD_LENGTH - password.length === 1 ? "" : "s"} — e.g. Summer26.`,
      hasMinLength: false,
      classes,
    };
  }
  if (!password.trim()) {
    return {
      valid: false,
      error: "Password cannot be spaces only.",
      level: "weak",
      score: 1,
      label: "Weak",
      hint: "Use letters, numbers, or a short memorable phrase.",
      hasMinLength: true,
      classes,
    };
  }
  const utf8Bytes = new TextEncoder().encode(password).length;
  if (utf8Bytes > MAX_PASSWORD_BYTES) {
    return {
      valid: false,
      error: "That password is too long; use 72 bytes or fewer.",
      level: "weak",
      score: 1,
      label: "Too long",
      hint: "Shorten to 72 bytes or fewer.",
      hasMinLength: true,
      classes,
    };
  }

  const lower = password.toLowerCase();
  const alphaOnly = lower.replace(/[^a-z]+/g, "");
  if (WEAK_PASSWORDS.has(lower) || (WEAK_BASE_WORDS.has(alphaOnly) && password.length < 12)) {
    return {
      valid: false,
      error: "That password is too common. Pick a personal phrase or mix letters, numbers, and symbols.",
      level: "weak",
      score: 1,
      label: "Too common",
      hint: "Pick a unique personal word combo + numbers like BlueRiver26.",
      hasMinLength: true,
      classes,
    };
  }
  if (/(.)\1\1\1/.test(password)) {
    return {
      valid: false,
      error: "Avoid repeating the same character 4+ times in a row.",
      level: "weak",
      score: 1,
      label: "Repeated",
      hint: "Avoid 4+ identical characters in a row.",
      hasMinLength: true,
      classes,
    };
  }
  if (password.length < 12 && WEAK_SEQUENCES.some((seq) => lower.includes(seq))) {
    return {
      valid: false,
      error: "Avoid obvious keyboard or number sequences like 12345 or qwerty.",
      level: "weak",
      score: 1,
      label: "Predictable",
      hint: "Swap sequences like 12345 or qwerty for a memorable phrase.",
      hasMinLength: true,
      classes,
    };
  }
  if (uniqueChars < 5) {
    return {
      valid: false,
      error: "Use more varied characters so your password is harder to guess.",
      level: "weak",
      score: 1,
      label: "Low variety",
      hint: "Include at least 5 different characters.",
      hasMinLength: true,
      classes,
    };
  }
  if (email) {
    const cleanedEmail = email.trim().toLowerCase();
    const localPart = cleanedEmail.split("@")[0] || "";
    if (lower === cleanedEmail || (localPart.length >= 4 && lower.includes(localPart) && lower.length <= localPart.length + 3)) {
      return {
        valid: false,
        error: "Do not use your email address as your password.",
        level: "weak",
        score: 1,
        label: "Matches email",
        hint: "Choose a password unrelated to your email address.",
        hasMinLength: true,
        classes,
      };
    }
  }

  const strongPassphrase = password.length >= 12 && classes >= 2 && uniqueChars >= 6;
  const strongMixed = classes >= 3;
  if (!strongPassphrase && !strongMixed) {
    return {
      valid: false,
      error: "Make it stronger: mix 3 of uppercase, lowercase, numbers, or symbols — or use a 12+ character passphrase.",
      level: "fair",
      score: 2,
      label: "Needs variety",
      hint: "Add an uppercase letter, number, or symbol — or stretch to 12+ characters.",
      hasMinLength: true,
      classes,
    };
  }

  const isTopTier = (password.length >= 12 && classes >= 3) || classes === 4;
  return {
    valid: true,
    error: null,
    level: "strong",
    score: 3,
    label: isTopTier ? "Very strong" : "Strong & memorable",
    hint: strongPassphrase ? "Great memorable passphrase." : "Strong mix — easy to remember, hard to guess.",
    hasMinLength: true,
    classes,
  };
}
