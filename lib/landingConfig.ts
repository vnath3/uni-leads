export type LandingVertical =
  | "pg"
  | "clinic"
  | "salon"
  | "coaching"
  | "cab"
  | "generic";

export type LandingContactHour = {
  label: string;
  value: string;
};

export type LandingConfigV1 = {
  version?: 1;
  vertical?: LandingVertical;
  brand?: {
    name?: string;
    tagline?: string;
    badge?: string;
  };
  contact?: {
    phone?: string;
    whatsapp?: string;
    email?: string;
    address_line?: string;
    map_url?: string;
    hours?: LandingContactHour[];
  };
  cta?: {
    primary?: {
      type?: "whatsapp" | "call" | "enquire";
      label?: string;
      prefill_template?: string;
    };
    secondary?: {
      type?: "call" | "directions" | "pricing" | "enquire";
      label?: string;
    };
    sticky_bar?: {
      enabled?: boolean;
      show_enquire?: boolean;
    };
  };
  hero?: {
    headline?: string;
    subheadline?: string;
    proof_chips?: string[];
    snapshot?: {
      title?: string;
      bullets?: string[];
    };
    media?: {
      hero_image_url?: string;
      gallery_strip_enabled?: boolean;
    };
  };
  sections?: {
    why_choose?: {
      enabled?: boolean;
      title?: string;
      subtitle?: string;
      items?: { title?: string; body?: string }[];
    };
    gallery?: {
      enabled?: boolean;
      title?: string;
      images?: { url?: string; caption?: string }[];
    };
    services?: {
      enabled?: boolean;
      title?: string;
      subtitle?: string;
      pricing_note?: string;
      items?: { title?: string; price?: string; body?: string }[];
    };
    testimonials?: {
      enabled?: boolean;
      title?: string;
      subtitle?: string;
      items?: { quote?: string; name?: string; role?: string }[];
    };
    faq?: {
      enabled?: boolean;
      title?: string;
      subtitle?: string;
      items?: { q?: string; a?: string }[];
    };
    location?: {
      enabled?: boolean;
      title?: string;
      subtitle?: string;
      show_map_button?: boolean;
      show_contact_card?: boolean;
    };
  };
  footer?: {
    show_share?: boolean;
    share_label?: string;
    developer_credit?: {
      enabled?: boolean;
      label?: string;
      url?: string;
    };
  };
  theme?: {
    theme_id?: string;
  };
};

export type LandingConfigResolved = {
  version: 1;
  vertical: LandingVertical;
  brand: {
    name: string;
    tagline: string;
    badge: string;
  };
  contact: {
    phone: string;
    whatsapp: string;
    email: string;
    address_line: string;
    map_url: string;
    hours: LandingContactHour[];
  };
  cta: {
    primary: {
      type: "whatsapp" | "call" | "enquire";
      label: string;
      prefill_template: string;
    };
    secondary: {
      type?: "call" | "directions" | "pricing" | "enquire";
      label: string;
    };
    sticky_bar: {
      enabled: boolean;
      show_enquire: boolean;
    };
  };
  hero: {
    headline: string;
    subheadline: string;
    proof_chips: string[];
    snapshot: {
      title: string;
      bullets: string[];
    };
    media: {
      hero_image_url: string;
      gallery_strip_enabled: boolean;
    };
  };
  sections: {
    why_choose: {
      enabled: boolean;
      title: string;
      subtitle: string;
      items: { title: string; body: string }[];
    };
    gallery: {
      enabled: boolean;
      title: string;
      images: { url: string; caption: string }[];
    };
    services: {
      enabled: boolean;
      title: string;
      subtitle: string;
      pricing_note: string;
      items: { title: string; price: string; body: string }[];
    };
    testimonials: {
      enabled: boolean;
      title: string;
      subtitle: string;
      items: { quote: string; name: string; role: string }[];
    };
    faq: {
      enabled: boolean;
      title: string;
      subtitle: string;
      items: { q: string; a: string }[];
    };
    location: {
      enabled: boolean;
      title: string;
      subtitle: string;
      show_map_button: boolean;
      show_contact_card: boolean;
    };
  };
  footer: {
    show_share: boolean;
    share_label: string;
    developer_credit: {
      enabled: boolean;
      label: string;
      url: string;
    };
  };
  theme: {
    theme_id: string;
  };
};

export type LandingSettings = {
  tenant_id?: string;
  name?: string;
  brand_name?: string;
  tagline?: string;
  logo_url?: string;
  primary_color?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  campaign?: string;
  lead_campaign?: string;
  default_campaign?: string;
  lead_form_schema?: Record<string, unknown> | null;
};

const defaultWhyChooseItems = [
  {
    title: "Fast response",
    body: "Replies in minutes via WhatsApp or call."
  },
  {
    title: "Verified and trusted",
    body: "Every enquiry gets a personal follow-up."
  },
  {
    title: "Flexible options",
    body: "Plans that match your budget and timing."
  },
  {
    title: "Prime location",
    body: "Easy to reach and close to key hubs."
  }
];

const defaultServicesItems = [
  {
    title: "Starter Plan",
    body: "Essentials for a quick start.",
    price: "From Rs. 4,999"
  },
  {
    title: "Standard Plan",
    body: "Most popular, balanced features.",
    price: "From Rs. 7,999"
  },
  {
    title: "Premium Plan",
    body: "All-inclusive support and upgrades.",
    price: "From Rs. 11,999"
  }
];

const defaultTestimonialsItems = [
  {
    quote: "We got a response within minutes and booked right away.",
    name: "Aarav",
    role: "Parent"
  },
  {
    quote: "Clean, calm, and exactly as promised.",
    name: "Meera",
    role: "Student"
  },
  {
    quote: "Transparent pricing and great follow-through.",
    name: "Dr. Anita",
    role: "Clinic lead"
  }
];

const defaultFaqItems = [
  {
    q: "How fast do you respond?",
    a: "Typically within 10 minutes on WhatsApp."
  },
  {
    q: "Can I schedule a visit?",
    a: "Yes, pick a time that suits you and we will confirm."
  },
  {
    q: "What details do you need to get started?",
    a: "Just your name, phone, and preferred timing."
  },
  {
    q: "Can I change plans later?",
    a: "Yes, upgrades are available anytime."
  }
];

const verticalProofChips: Record<LandingVertical, string[]> = {
  pg: [
    "Walking distance to coaching",
    "Homely food + safe environment",
    "Limited beds (10 total)"
  ],
  clinic: [
    "Physio-led care plans",
    "Same-day appointment slots",
    "Evidence-based rehab"
  ],
  salon: ["Expert stylists", "Premium products", "Walk-in friendly"],
  coaching: ["Experienced mentors", "Small batches", "Results-driven guidance"],
  cab: ["Airport pickups on time", "Clean, comfortable cabs", "Local coverage"],
  generic: [
    "Fast response on WhatsApp",
    "Verified local team",
    "Transparent pricing"
  ]
};

const verticalServiceTitle: Record<LandingVertical, string> = {
  pg: "Room types",
  clinic: "Treatments & packages",
  salon: "Popular services",
  coaching: "Courses & batches",
  cab: "Services",
  generic: "Services and packages"
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (isNonEmptyString(value)) return value.trim();
  }
  return "";
};

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.filter(isNonEmptyString).map((item) => item.trim());
};

const normalizePrimaryType = (
  value: unknown
): "whatsapp" | "call" | "enquire" => {
  const normalized = isNonEmptyString(value) ? value.toLowerCase() : "";
  if (normalized === "call") return "call";
  if (normalized === "enquire" || normalized === "inquire") return "enquire";
  return "whatsapp";
};

const normalizeSecondaryType = (
  value: unknown
): "call" | "directions" | "pricing" | "enquire" | undefined => {
  const normalized = isNonEmptyString(value) ? value.toLowerCase() : "";
  if (normalized === "call") return "call";
  if (normalized === "directions" || normalized === "direction") return "directions";
  if (normalized === "pricing" || normalized === "prices") return "pricing";
  if (normalized === "enquire" || normalized === "inquire") return "enquire";
  return undefined;
};

const normalizeVertical = (value: unknown): LandingVertical | null => {
  const normalized = isNonEmptyString(value) ? value.toLowerCase().trim() : "";
  if (
    normalized === "pg" ||
    normalized === "clinic" ||
    normalized === "salon" ||
    normalized === "coaching" ||
    normalized === "cab" ||
    normalized === "generic"
  ) {
    return normalized as LandingVertical;
  }
  return null;
};

const normalizeWhyChooseItems = (value: unknown) => {
  if (!Array.isArray(value)) return defaultWhyChooseItems;
  const items = value
    .map((item) => {
      if (isNonEmptyString(item)) {
        return { title: item.trim(), body: "Details available on request." };
      }
      const record = asRecord(item);
      if (!record) return null;
      const title = pickString(record.title, record.heading, record.name);
      if (!title) return null;
      const body =
        pickString(record.body, record.description, record.detail, record.subtitle) ||
        "Details available on request.";
      return { title, body };
    })
    .filter((item): item is { title: string; body: string } => Boolean(item));
  return items;
};

const normalizeServicesItems = (value: unknown) => {
  if (!Array.isArray(value)) return defaultServicesItems;
  const items = value
    .map((item) => {
      if (isNonEmptyString(item)) {
        return { title: item.trim(), body: "Tailored option available.", price: "" };
      }
      const record = asRecord(item);
      if (!record) return null;
      const title = pickString(record.title, record.heading, record.name);
      if (!title) return null;
      const body =
        pickString(record.body, record.description, record.detail, record.subtitle) ||
        "Tailored option available.";
      const price = pickString(record.price, record.rate, record.cost);
      return { title, body, price };
    })
    .filter((item): item is { title: string; body: string; price: string } => Boolean(item));
  return items;
};

const normalizeTestimonialsItems = (value: unknown) => {
  if (!Array.isArray(value)) return defaultTestimonialsItems;
  const items = value
    .map((item) => {
      if (isNonEmptyString(item)) {
        return { quote: item.trim(), name: "Customer", role: "" };
      }
      const record = asRecord(item);
      if (!record) return null;
      const quote = pickString(record.quote, record.text, record.feedback);
      if (!quote) return null;
      const name = pickString(record.name, record.author) || "Customer";
      const role = pickString(record.role, record.meta);
      return { quote, name, role };
    })
    .filter(
      (item): item is { quote: string; name: string; role: string } => Boolean(item)
    );
  return items;
};

const normalizeFaqItems = (value: unknown) => {
  if (!Array.isArray(value)) return defaultFaqItems;
  const items = value
    .map((item) => {
      if (isNonEmptyString(item)) {
        return { q: item.trim(), a: "We can share details on request." };
      }
      const record = asRecord(item);
      if (!record) return null;
      const q = pickString(record.q, record.question, record.title);
      if (!q) return null;
      const a =
        pickString(record.a, record.answer, record.detail) ||
        "We can share details on request.";
      return { q, a };
    })
    .filter((item): item is { q: string; a: string } => Boolean(item));
  return items;
};

const normalizeGalleryImages = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (isNonEmptyString(item)) {
        return { url: item.trim(), caption: "" };
      }
      const record = asRecord(item);
      if (!record) return null;
      const url = pickString(record.url, record.src);
      if (!url) return null;
      const caption = pickString(record.caption, record.label);
      return { url, caption };
    })
    .filter((item): item is { url: string; caption: string } => Boolean(item));
};

const normalizeHours = (value: unknown): LandingContactHour[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (isNonEmptyString(item)) {
        const trimmed = item.trim();
        if (!trimmed) return null;
        const [label, ...rest] = trimmed.split(":");
        if (rest.length === 0) {
          return { label: trimmed, value: "" };
        }
        return { label: label.trim(), value: rest.join(":").trim() };
      }
      const record = asRecord(item);
      if (!record) return null;
      const label = pickString(record.label);
      const valueText = pickString(record.value);
      if (!label && !valueText) return null;
      return { label: label || "", value: valueText || "" };
    })
    .filter((item): item is LandingContactHour => Boolean(item));
};

const getTrustPoints = (schema: Record<string, unknown> | null) => {
  if (!schema) return [];
  return normalizeStringArray(schema.trust_points);
};

const inferVerticalFromSchema = (
  schema: Record<string, unknown> | null,
  trustPoints: string[]
): LandingVertical => {
  const fields = Array.isArray(schema?.fields) ? schema?.fields : [];
  const fieldKeys = fields
    .map((field) => {
      const record = asRecord(field);
      if (!record) return "";
      return pickString(record.key);
    })
    .filter(Boolean)
    .map((item) => item.toLowerCase());

  if (fieldKeys.some((key) => key.includes("pain_area"))) return "clinic";
  if (
    fieldKeys.some((key) =>
      ["pickup", "drop", "trip_type", "travel_time"].some((token) =>
        key.includes(token)
      )
    )
  ) {
    return "cab";
  }
  if (
    fieldKeys.some((key) =>
      ["student_type", "move_in_month", "move_in"].some((token) =>
        key.includes(token)
      )
    )
  ) {
    return "pg";
  }

  const trustLine = trustPoints.join(" ").toLowerCase();
  if (trustLine.includes("physio") || trustLine.includes("appointment")) {
    return "clinic";
  }
  if (trustLine.includes("airport") || trustLine.includes("cab")) {
    return "cab";
  }
  if (trustLine.includes("beds") || trustLine.includes("hostel")) {
    return "pg";
  }

  return "generic";
};

const getDefaultLandingConfig = (): LandingConfigV1 => ({
  version: 1,
  vertical: "generic",
  brand: {
    name: "",
    tagline: "",
    badge: "Trusted local team"
  },
  contact: {
    phone: "",
    whatsapp: "",
    email: "",
    address_line: "",
    map_url: "",
    hours: []
  },
  cta: {
    primary: {
      type: "whatsapp",
      label: "WhatsApp",
      prefill_template: "Hi, I want to enquire about {brand_name}."
    },
    secondary: {
      label: ""
    },
    sticky_bar: {
      enabled: true,
      show_enquire: true
    }
  },
  hero: {
    headline: "",
    subheadline: "Fast, friendly, and verified support for your next enquiry.",
    proof_chips: [],
    snapshot: {
      title: "Quick snapshot",
      bullets: []
    },
    media: {
      hero_image_url: "",
      gallery_strip_enabled: false
    }
  },
  sections: {
    why_choose: {
      enabled: true,
      title: "Why choose us",
      subtitle: "The details that matter before you decide.",
      items: defaultWhyChooseItems
    },
    gallery: {
      enabled: true,
      title: "Gallery",
      images: []
    },
    services: {
      enabled: true,
      title: "Services and packages",
      subtitle: "Choose the plan that fits your needs.",
      pricing_note: "",
      items: defaultServicesItems
    },
    testimonials: {
      enabled: true,
      title: "People love the experience",
      subtitle: "Recent feedback from real visitors.",
      items: defaultTestimonialsItems
    },
    faq: {
      enabled: true,
      title: "FAQ",
      subtitle: "Quick answers to common questions.",
      items: defaultFaqItems
    },
    location: {
      enabled: true,
      title: "Location and hours",
      subtitle: "Find us or reach out anytime.",
      show_map_button: true,
      show_contact_card: true
    }
  },
  footer: {
    show_share: true,
    share_label: "Share this page",
    developer_credit: {
      enabled: false,
      label: "",
      url: ""
    }
  },
  theme: {
    theme_id: ""
  }
});

const buildLegacyLandingConfig = (
  landingRaw: Record<string, unknown>,
  trustPoints: string[]
): LandingConfigV1 => {
  const legacy: LandingConfigV1 = {};
  const legacyBadge = pickString(landingRaw.trust_line, landingRaw.trustline);
  const proofPoints = normalizeStringArray(
    landingRaw.proof_points ?? landingRaw.proofPoints ?? landingRaw.proof_chips
  );

  const primaryType = normalizePrimaryType(landingRaw.primary_cta_type);
  const primaryLabel = pickString(landingRaw.primary_cta_label);
  const secondaryLabel = pickString(landingRaw.secondary_cta_label);
  const whatsapp = pickString(
    landingRaw.whatsapp_number,
    landingRaw.whatsapp,
    landingRaw.whatsappNumber
  );

  const heroHeadline = pickString(landingRaw.headline, landingRaw.hero_headline);
  const heroSubheadline = pickString(
    landingRaw.subheadline,
    landingRaw.hero_subheadline
  );

  const whyChooseItems = normalizeWhyChooseItems(
    landingRaw.why_choose ?? landingRaw.benefits
  );
  const servicesItems = normalizeServicesItems(
    landingRaw.services ?? landingRaw.packages
  );
  const testimonialsItems = normalizeTestimonialsItems(
    landingRaw.testimonials ?? landingRaw.reviews
  );
  const faqItems = normalizeFaqItems(
    landingRaw.faq ?? landingRaw.faqs ?? landingRaw.questions
  );
  const galleryImages = normalizeGalleryImages(
    landingRaw.gallery ?? landingRaw.images ?? landingRaw.gallery_images
  );
  const hours = normalizeHours(landingRaw.hours ?? landingRaw.opening_hours);

  if (
    legacyBadge ||
    heroHeadline ||
    heroSubheadline ||
    proofPoints.length > 0 ||
    trustPoints.length > 0
  ) {
    legacy.brand = legacy.brand ?? {};
    if (legacyBadge) legacy.brand.badge = legacyBadge;

    legacy.hero = legacy.hero ?? {};
    if (heroHeadline) legacy.hero.headline = heroHeadline;
    if (heroSubheadline) legacy.hero.subheadline = heroSubheadline;
    if (proofPoints.length > 0) legacy.hero.proof_chips = proofPoints;
    if (trustPoints.length > 0) {
      legacy.hero.snapshot = legacy.hero.snapshot ?? {};
      legacy.hero.snapshot.bullets = trustPoints;
    }
  }

  if (whatsapp || hours.length > 0) {
    legacy.contact = legacy.contact ?? {};
    if (whatsapp) legacy.contact.whatsapp = whatsapp;
    if (hours.length > 0) legacy.contact.hours = hours;
  }

  if (primaryType || primaryLabel || secondaryLabel) {
    legacy.cta = legacy.cta ?? {};
    legacy.cta.primary = legacy.cta.primary ?? {};
    legacy.cta.primary.type = primaryType;
    if (primaryLabel) legacy.cta.primary.label = primaryLabel;
    if (secondaryLabel) {
      legacy.cta.secondary = legacy.cta.secondary ?? {};
      legacy.cta.secondary.label = secondaryLabel;
    }
  }

  if (whyChooseItems.length > 0) {
    legacy.sections = legacy.sections ?? {};
    legacy.sections.why_choose = legacy.sections.why_choose ?? {};
    legacy.sections.why_choose.items = whyChooseItems;
  }
  if (servicesItems.length > 0) {
    legacy.sections = legacy.sections ?? {};
    legacy.sections.services = legacy.sections.services ?? {};
    legacy.sections.services.items = servicesItems;
  }
  if (testimonialsItems.length > 0) {
    legacy.sections = legacy.sections ?? {};
    legacy.sections.testimonials = legacy.sections.testimonials ?? {};
    legacy.sections.testimonials.items = testimonialsItems;
  }
  if (faqItems.length > 0) {
    legacy.sections = legacy.sections ?? {};
    legacy.sections.faq = legacy.sections.faq ?? {};
    legacy.sections.faq.items = faqItems;
  }
  if (galleryImages.length > 0) {
    legacy.sections = legacy.sections ?? {};
    legacy.sections.gallery = legacy.sections.gallery ?? {};
    legacy.sections.gallery.images = galleryImages;
  }

  return legacy;
};

const hasLandingConfigShape = (landingRaw: Record<string, unknown>) => {
  if (landingRaw.version === 1 || landingRaw.version === "1") return true;
  return ["brand", "contact", "cta", "hero", "sections", "footer", "theme"].some(
    (key) => key in landingRaw
  );
};

export const deepMerge = <T extends Record<string, unknown>>(
  base: T,
  ...sources: Partial<T>[]
): T => {
  const mergeValue = (target: unknown, source: unknown): unknown => {
    if (source === undefined) return target;
    if (Array.isArray(source)) return [...source];
    const sourceRecord = asRecord(source);
    if (!sourceRecord) return source;
    const targetRecord = asRecord(target) ?? {};
    const output: Record<string, unknown> = { ...targetRecord };
    for (const [key, value] of Object.entries(sourceRecord)) {
      output[key] = mergeValue(output[key], value);
    }
    return output;
  };

  let result: Record<string, unknown> = { ...base };
  for (const source of sources) {
    result = mergeValue(result, source) as Record<string, unknown>;
  }
  return result as T;
};

export const interpolateTemplate = (
  template: string,
  values: Record<string, unknown>
) => {
  const tokens = template.replace(/\{([^}]+)\}/g, (_match, rawKey) => {
    const key = String(rawKey).trim().toLowerCase();
    const value = values[key];
    if (value === null || value === undefined) return "";
    return String(value);
  });
  return tokens.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
};

export const resolveLandingConfig = (
  settings: LandingSettings | null,
  options?: { slug?: string }
): LandingConfigResolved => {
  const leadSchema = asRecord(settings?.lead_form_schema) ?? null;
  const landingRaw = asRecord(leadSchema?.landing) ?? {};
  const trustPoints = getTrustPoints(leadSchema);
  const inferredVertical = inferVerticalFromSchema(leadSchema, trustPoints);
  const legacyConfig = buildLegacyLandingConfig(landingRaw, trustPoints);
  const configCandidate = hasLandingConfigShape(landingRaw) ? landingRaw : {};
  const merged = deepMerge(
    getDefaultLandingConfig(),
    legacyConfig,
    configCandidate as LandingConfigV1
  );

  const vertical =
    normalizeVertical(merged.vertical) ?? normalizeVertical(landingRaw.vertical) ??
    inferredVertical;

  const brandName = pickString(
    merged.brand?.name,
    settings?.brand_name,
    settings?.name,
    options?.slug
  );
  const brandTagline = pickString(merged.brand?.tagline, settings?.tagline);

  const addressLine = pickString(merged.contact?.address_line, settings?.address);
  const mapUrl =
    pickString(merged.contact?.map_url) ||
    (addressLine
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          addressLine
        )}`
      : "");

  const proofFallback =
    trustPoints.length > 0 ? trustPoints : verticalProofChips[vertical];

  const configHero = asRecord(configCandidate.hero);
  const configSnapshot = asRecord(configHero?.snapshot);
  const hasProofChips = Array.isArray(configHero?.proof_chips);
  const hasSnapshotBullets = Array.isArray(configSnapshot?.bullets);
  const proofChips = hasProofChips
    ? normalizeStringArray(configHero?.proof_chips)
    : normalizeStringArray(merged.hero?.proof_chips);
  const snapshotBullets = hasSnapshotBullets
    ? normalizeStringArray(configSnapshot?.bullets)
    : normalizeStringArray(merged.hero?.snapshot?.bullets);

  const servicesTitle =
    pickString(merged.sections?.services?.title) || verticalServiceTitle[vertical];

  const resolved: LandingConfigResolved = {
    version: 1,
    vertical,
    brand: {
      name: brandName,
      tagline: brandTagline,
      badge: pickString(merged.brand?.badge) || "Trusted local team"
    },
    contact: {
      phone: pickString(merged.contact?.phone, settings?.contact_phone),
      whatsapp: pickString(
        merged.contact?.whatsapp,
        merged.contact?.phone,
        settings?.contact_phone
      ),
      email: pickString(merged.contact?.email, settings?.contact_email),
      address_line: addressLine,
      map_url: mapUrl,
      hours: normalizeHours(merged.contact?.hours)
    },
    cta: {
      primary: {
        type: normalizePrimaryType(merged.cta?.primary?.type),
        label: pickString(merged.cta?.primary?.label),
        prefill_template: pickString(merged.cta?.primary?.prefill_template)
      },
      secondary: {
        type: normalizeSecondaryType(merged.cta?.secondary?.type),
        label: pickString(merged.cta?.secondary?.label)
      },
      sticky_bar: {
        enabled: merged.cta?.sticky_bar?.enabled !== false,
        show_enquire: merged.cta?.sticky_bar?.show_enquire !== false
      }
    },
    hero: {
      headline:
        pickString(merged.hero?.headline) || brandName || "Get a quick response",
      subheadline:
        pickString(merged.hero?.subheadline) ||
        brandTagline ||
        "Fast, friendly, and verified support for your next enquiry.",
      proof_chips: hasProofChips
        ? proofChips
        : proofChips.length > 0
          ? proofChips
          : proofFallback,
      snapshot: {
        title: pickString(merged.hero?.snapshot?.title) || "Quick snapshot",
        bullets: hasSnapshotBullets
          ? snapshotBullets
          : snapshotBullets.length > 0
            ? snapshotBullets
            : proofFallback
      },
      media: {
        hero_image_url: pickString(merged.hero?.media?.hero_image_url),
        gallery_strip_enabled: Boolean(merged.hero?.media?.gallery_strip_enabled)
      }
    },
    sections: {
      why_choose: {
        enabled: merged.sections?.why_choose?.enabled !== false,
        title: pickString(merged.sections?.why_choose?.title) || "Why choose us",
        subtitle:
          pickString(merged.sections?.why_choose?.subtitle) ||
          "The details that matter before you decide.",
        items: normalizeWhyChooseItems(merged.sections?.why_choose?.items)
      },
      gallery: {
        enabled: merged.sections?.gallery?.enabled !== false,
        title: pickString(merged.sections?.gallery?.title) || "Gallery",
        images: normalizeGalleryImages(merged.sections?.gallery?.images)
      },
      services: {
        enabled: merged.sections?.services?.enabled !== false,
        title: servicesTitle,
        subtitle:
          pickString(merged.sections?.services?.subtitle) ||
          "Choose the plan that fits your needs.",
        pricing_note: pickString(merged.sections?.services?.pricing_note),
        items: normalizeServicesItems(merged.sections?.services?.items)
      },
      testimonials: {
        enabled: merged.sections?.testimonials?.enabled !== false,
        title:
          pickString(merged.sections?.testimonials?.title) ||
          "People love the experience",
        subtitle:
          pickString(merged.sections?.testimonials?.subtitle) ||
          "Recent feedback from real visitors.",
        items: normalizeTestimonialsItems(merged.sections?.testimonials?.items)
      },
      faq: {
        enabled: merged.sections?.faq?.enabled !== false,
        title: pickString(merged.sections?.faq?.title) || "FAQ",
        subtitle:
          pickString(merged.sections?.faq?.subtitle) ||
          "Quick answers to common questions.",
        items: normalizeFaqItems(merged.sections?.faq?.items)
      },
      location: {
        enabled: merged.sections?.location?.enabled !== false,
        title:
          pickString(merged.sections?.location?.title) || "Location and hours",
        subtitle:
          pickString(merged.sections?.location?.subtitle) ||
          "Find us or reach out anytime.",
        show_map_button: merged.sections?.location?.show_map_button !== false,
        show_contact_card: merged.sections?.location?.show_contact_card !== false
      }
    },
    footer: {
      show_share: merged.footer?.show_share !== false,
      share_label: pickString(merged.footer?.share_label) || "Share this page",
      developer_credit: {
        enabled: merged.footer?.developer_credit?.enabled === true,
        label: pickString(merged.footer?.developer_credit?.label),
        url: pickString(merged.footer?.developer_credit?.url)
      }
    },
    theme: {
      theme_id: pickString(merged.theme?.theme_id)
    }
  };

  if (!resolved.cta.primary.label) {
    resolved.cta.primary.label =
      resolved.cta.primary.type === "call"
        ? "Call"
        : resolved.cta.primary.type === "enquire"
          ? "Enquire"
          : "WhatsApp";
  }

  return resolved;
};
