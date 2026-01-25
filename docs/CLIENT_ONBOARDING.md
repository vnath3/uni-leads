# Client Onboarding (Uni-Leads landing vs external website)

Use this guide when onboarding a new tenant. It covers both flows:
1) Use Uni-Leads landing page (hosted in this app).
2) Client has their own external marketing site.

---

## Option A: Use Uni-Leads landing page

1) In `/super/create-tenant`, keep "Use Uni-Leads landing page" selected.
2) Fill the landing content and trust sections.
3) Create the tenant.
4) Open `/t/<slug>` and confirm the landing renders.
5) (Optional) Add a custom domain in `/super` -> Domain section.

Notes:
- Lead capture still uses `/api/lead-submit` behind the scenes.
- You can edit the landing later at `/super/tenants/<tenant_id>/landing`.

---

## Option B: Client has own website (external marketing site)

1) In `/super/create-tenant`, select
   "Client has own website (external marketing site)".
2) Skip landing steps and create the tenant.
3) Set the marketing URL in `/t/<slug>/admin/settings` (Business profile).
4) Share the "Embed / integrate form" payload from the same settings page.

---

## Netlify env vars for external site

When the client site is hosted on Netlify, add these build env vars:

- `UNI_LEADS_SUBMIT_URL` = `https://<your-app-host>/api/lead-submit`
- `UNI_LEADS_TENANT_SLUG` = `<tenant-slug>`

Example:
- `UNI_LEADS_SUBMIT_URL` = `https://uni-leads.netlify.app/api/lead-submit`
- `UNI_LEADS_TENANT_SLUG` = `jyoti-pg`

---

## Example embed script (external site)

```html
<script>
  async function submitLead(values) {
    const res = await fetch(window.ENV.UNI_LEADS_SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity_type: "slug",
        identity_value: window.ENV.UNI_LEADS_TENANT_SLUG,
        contact: {
          full_name: values.full_name,
          phone: values.phone,
          email: values.email
        },
        form_payload: values,
        source: "website",
        campaign: values.campaign || "organic"
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Lead submit failed");
    return data;
  }
</script>
```

Replace `window.ENV.*` with your site's env injection pattern.
