import type { RecordType } from "@/lib/dns";

export type ProviderId = "cloudflare" | "godaddy" | "namecheap" | "route53" | "google" | "generic";

export type Provider = {
  id: ProviderId;
  label: string;
  /** Deep link to where DNS records are edited, when the provider has a stable one. */
  recordsUrl: string | null;
  /** What this provider calls the root of the domain in its Name/Host field. */
  rootHostLabel: string;
  /** Whether this provider wants the bare subdomain or the fully qualified host. */
  hostStyle: "relative" | "absolute";
  instructions: Record<"TXT" | "CNAME" | "MX", string[]>;
  /** Provider-specific gotchas worth saying before the user hits them. */
  notes: string[];
};

/**
 * Nameserver suffix → provider. Matching is on the *suffix* of the nameserver
 * hostname, so `ns.cloudflare.com.evil.example` is not mistaken for Cloudflare.
 */
const NAMESERVER_PATTERNS: { suffix: RegExp; provider: ProviderId }[] = [
  // Customer zones use `<name>.ns.cloudflare.com`, but Cloudflare also serves
  // zones from `ns3.cloudflare.com` and friends, so match the whole domain.
  { suffix: /(^|\.)cloudflare\.com$/, provider: "cloudflare" },
  { suffix: /(^|\.)domaincontrol\.com$/, provider: "godaddy" },
  { suffix: /(^|\.)godaddy\.com$/, provider: "godaddy" },
  { suffix: /(^|\.)registrar-servers\.com$/, provider: "namecheap" },
  { suffix: /(^|\.)awsdns-[0-9]+\.(com|net|org|co\.uk)$/, provider: "route53" },
  { suffix: /(^|\.)googledomains\.com$/, provider: "google" },
  { suffix: /(^|\.)google\.com$/, provider: "google" },
];

export const PROVIDERS: Record<ProviderId, Provider> = {
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare",
    recordsUrl: "https://dash.cloudflare.com",
    rootHostLabel: "@",
    hostStyle: "relative",
    instructions: {
      TXT: [
        "Open the Cloudflare dashboard and pick this domain, then go to DNS → Records.",
        "Click Add record and choose TXT as the type.",
        "Set Name to @ — that means the root domain. Do not type the domain name in here; Cloudflare will append it and you'll end up with acme.com.acme.com.",
        "Paste the value into Content exactly as shown, with no surrounding quotes.",
        "Click Save.",
      ],
      CNAME: [
        "In Cloudflare's DNS → Records screen, click Add record and choose CNAME.",
        "Set Name to the subdomain part only (dk1._domainkey), not the whole hostname.",
        "Set Target to the value shown.",
        "Set the Proxy status toggle to DNS only — the grey cloud. An orange cloud makes Cloudflare answer with its own IPs and the record will never verify.",
        "Click Save.",
      ],
      MX: [
        "In Cloudflare's DNS → Records screen, click Add record and choose MX.",
        "Set Name to @ for the root domain.",
        "Set Mail server to the value shown and Priority to 10.",
        "Click Save.",
      ],
    },
    notes: [
      "Cloudflare's orange-cloud proxy is the single most common reason a CNAME won't verify. Records used for email must be set to DNS only.",
      "Cloudflare usually publishes changes within seconds, so if a record still doesn't show up after a minute, the record itself is wrong rather than slow.",
    ],
  },

  godaddy: {
    id: "godaddy",
    label: "GoDaddy",
    recordsUrl: "https://dcc.godaddy.com/control/dnsmanagement",
    rootHostLabel: "@",
    hostStyle: "relative",
    instructions: {
      TXT: [
        "In GoDaddy, go to My Products → your domain → DNS, then Add New Record.",
        "Choose TXT as the type.",
        "Set Name to @ for the root domain.",
        "Paste the value into the Value field, with no quotes around it.",
        "Click Save.",
      ],
      CNAME: [
        "In the GoDaddy DNS screen, click Add New Record and choose CNAME.",
        "Set Name to the subdomain part only (dk1._domainkey).",
        "Set Value to the target shown, and leave TTL at 1 Hour.",
        "Click Save.",
      ],
      MX: [
        "In the GoDaddy DNS screen, click Add New Record and choose MX.",
        "Set Name to @ and Value to the mail server shown.",
        "Set Priority to 10.",
        "Click Save.",
      ],
    },
    notes: [
      "GoDaddy adds the domain to whatever you type in Name. Typing the full hostname there produces dk1._domainkey.acme.com.acme.com, which is the most common GoDaddy mistake.",
      "GoDaddy can take 10–30 minutes to publish a change even though the dashboard shows it immediately.",
    ],
  },

  namecheap: {
    id: "namecheap",
    label: "Namecheap",
    recordsUrl: "https://ap.www.namecheap.com/domains/list",
    rootHostLabel: "@",
    hostStyle: "relative",
    instructions: {
      TXT: [
        "In Namecheap, go to Domain List → Manage on this domain → Advanced DNS.",
        "Under Host Records, click Add New Record and choose TXT Record.",
        "Set Host to @ for the root domain.",
        "Paste the value into Value, then click the green checkmark to save the row.",
      ],
      CNAME: [
        "In Namecheap's Advanced DNS tab, click Add New Record and choose CNAME Record.",
        "Set Host to the subdomain part only (dk1._domainkey).",
        "Set Value to the target shown and save the row with the green checkmark.",
      ],
      MX: [
        "In Namecheap's Advanced DNS tab, set Mail Settings to Custom MX first — otherwise Namecheap ignores MX rows.",
        "Click Add New Record and choose MX Record.",
        "Set Host to @, Value to the mail server shown, and Priority to 10.",
        "Save the row with the green checkmark.",
      ],
    },
    notes: [
      "Namecheap does not save a row until you click the green checkmark at the end of it. A row left in edit mode looks correct on screen but was never published.",
      "MX records are ignored unless Mail Settings is set to Custom MX.",
    ],
  },

  route53: {
    id: "route53",
    label: "AWS Route 53",
    recordsUrl: "https://console.aws.amazon.com/route53/v2/hostedzones",
    rootHostLabel: "the domain itself",
    hostStyle: "absolute",
    instructions: {
      TXT: [
        "Open Route 53 → Hosted zones and select this domain's zone.",
        "Click Create record and choose TXT as the record type.",
        "Leave Record name empty to target the root domain.",
        'Put the value in Value wrapped in double quotes — Route 53 is one of the few providers that requires them: "domainkit-verify=…".',
        "Click Create records.",
      ],
      CNAME: [
        "In the Route 53 hosted zone, click Create record and choose CNAME.",
        "Set Record name to the subdomain part only (dk1._domainkey).",
        "Put the target in Value, with no quotes.",
        "Click Create records.",
      ],
      MX: [
        "In the Route 53 hosted zone, click Create record and choose MX.",
        "Leave Record name empty for the root domain.",
        "Set Value to `10 mx.domainkit.app` — Route 53 takes the priority and the host together in one field.",
        "Click Create records.",
      ],
    },
    notes: [
      "Route 53 wants TXT values in double quotes, and it wants MX priority in the same field as the hostname. Both are the opposite of most other providers.",
      "If the domain has more than one hosted zone, make sure you are editing the one your registrar's nameservers actually point at.",
    ],
  },

  google: {
    id: "google",
    label: "Google Domains / Cloud DNS",
    recordsUrl: "https://domains.google.com/registrar",
    rootHostLabel: "@",
    hostStyle: "relative",
    instructions: {
      TXT: [
        "Open your DNS settings for this domain and find Custom records.",
        "Add a record with type TXT.",
        "Set Host name to @ for the root domain.",
        "Paste the value into Data, with no quotes.",
        "Click Save.",
      ],
      CNAME: [
        "In your Google DNS settings, under Custom records, add a record with type CNAME.",
        "Set Host name to the subdomain part only (dk1._domainkey).",
        "Set Data to the target shown.",
        "Click Save.",
      ],
      MX: [
        "In your Google DNS settings, under Custom records, add a record with type MX.",
        "Set Host name to @ and Data to `10 mx.domainkit.app`.",
        "Click Save.",
      ],
    },
    notes: [
      "Google Domains transferred most registrations to Squarespace. If the dashboard looks unfamiliar, you are probably editing DNS in Squarespace now — the field names are the same.",
    ],
  },

  generic: {
    id: "generic",
    label: "your DNS provider",
    recordsUrl: null,
    rootHostLabel: "@ (or a blank host)",
    hostStyle: "relative",
    instructions: {
      TXT: [
        "Sign in to wherever this domain's DNS is managed and find the DNS records screen.",
        "Add a new record of type TXT.",
        "For the host or name field, use @ or leave it blank — both mean the root domain at most providers.",
        "Paste the value exactly. If your provider stores TXT values with quotes, include them; most do this for you.",
        "Save the record.",
      ],
      CNAME: [
        "Add a new record of type CNAME.",
        "Most providers want only the subdomain part in the host field (dk1._domainkey) and append the domain themselves. If yours shows the full hostname after saving, that's correct.",
        "Set the target or value to the hostname shown.",
        "Save the record.",
      ],
      MX: [
        "Add a new record of type MX.",
        "Use @ or a blank host for the root domain.",
        "Set the mail server to the hostname shown and the priority to 10. Some providers put both in one field as `10 mx.domainkit.app`.",
        "Save the record.",
      ],
    },
    notes: [
      "We couldn't identify your DNS provider from its nameservers, so these are the general steps. The field names differ between providers but the three values never change.",
    ],
  },
};

/** Match a domain's nameservers against the known providers. */
export function detectProvider(nameservers: string[]): ProviderId {
  for (const nameserver of nameservers) {
    const host = nameserver.trim().toLowerCase().replace(/\.$/, "");
    for (const { suffix, provider } of NAMESERVER_PATTERNS) {
      if (suffix.test(host)) {
        return provider;
      }
    }
  }
  return "generic";
}

export function getProvider(id: string): Provider {
  return PROVIDERS[id as ProviderId] ?? PROVIDERS.generic;
}

/** `generic` is the fallback, not a detection — the UI offers a manual override for it. */
export function isKnownProvider(id: string): boolean {
  return id in PROVIDERS && id !== "generic";
}

/** The instruction list for one record type at one provider. */
export function instructionsFor(id: string, type: Extract<RecordType, "TXT" | "CNAME" | "MX">) {
  return getProvider(id).instructions[type];
}
