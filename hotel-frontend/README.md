# 🏨 Hotelogx Connect Frontend

Modern, fast, and responsive user interface for **Hotelogx Connect**, built using React 19, TanStack Start / Router, Vite, and Tailwind CSS v4.

---

## ⚡ Tech Stack & Architecture

- **React**: `v19.2`
- **Routing & Framework**: `@tanstack/react-router` & `@tanstack/react-start`
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS v4
- **Icons**: Lucide React
- **Language**: TypeScript

---

## 🚀 Getting Started

### Prerequisites

Ensure you have **Node.js** (v18 or higher) installed on your machine.

### Installation & Execution

1. Navigate to the frontend directory:
   ```bash
   cd hotel-fronted
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

The application will be accessible at **`http://localhost:3000`**.

---

## 📜 Available NPM Scripts

- `npm run dev`: Launches the Vite development server with hot-module replacement (HMR) on port `3000`.
- `npm run build`: Bundles the application for production deployment (includes Netlify build plugin).

---

## 📁 Directory Structure

```text
hotel-fronted/
├── public/              # Static assets
├── src/
│   ├── components/      # Reusable UI components
│   ├── lib/             # Helper utilities, API clients & state stores
│   ├── routes/          # TanStack file-based routes
│   ├── routeTree.gen.ts # Auto-generated route tree
│   ├── router.tsx       # Router configuration
│   └── styles.css       # Global styles & Tailwind imports
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
└── vite.config.ts       # Vite & plugin configuration
```

---

## 🔗 Backend Integration

The frontend connects to the Express API running at `http://localhost:5000`. Make sure the backend server is running concurrently.
