# YourDJs - Svatební DJ

Profesionální svatební DJ služby pro Moravu & Slezsko.

## 🚀 Development

### Prerequisites
- Node.js (v16 nebo novější)
- npm

### Installation

```bash
npm install
```

### Building CSS

```bash
# Sestavit optimalizovaný CSS (production)
npm run build:css

# Sledovat změny (development)
npm run watch:css
```

### Deployment

Projekt je automaticky deployován na Vercel. CSS se sestavuje automaticky při každém deployi.

## 📦 Dependencies

- **TailwindCSS** (3.4.1) - Utility-first CSS framework
- **PostCSS** (8.4.33) - CSS processor
- **Autoprefixer** (10.4.17) - Vendor prefix automation

## 🔧 Project Structure

```
/
├── index.html              # Hlavní stránka
├── dekujeme/               # Thank you page
├── svatebni-dj-brno/      # Brno landing page
├── svatebni-dj-ostrava/   # Ostrava landing page
├── api/                    # Vercel serverless functions
│   ├── health.js          # Health check endpoint
│   └── lead.js            # Lead form handler (Airtable)
├── assets/                 # Static assets
│   └── styles.css         # Compiled TailwindCSS (20KB)
├── src/
│   └── input.css          # TailwindCSS source
├── Vercel.json            # Vercel configuration
├── package.json           # Dependencies
└── tailwind.config.js     # Tailwind configuration
```

## 🔒 Security

Projekt implementuje následující security headers:
- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=()

## 📊 Performance

- CSS optimalizace: 20KB (místo původních ~3MB z CDN)
- Redukce velikosti: 99.3%
- Všechny assety cache-ovány po dobu 1 roku

## 📝 License

© 2025 YourDJs™. All rights reserved.
