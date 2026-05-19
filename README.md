# 🛠 Record Manager

A sleek, premium DNS administration portal for Cloudflare, built using Hono, Cloudflare Workers, and D1 SQL.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/simon-msdos/record-manager)

---

## 🚀 Quick Start (One-Click Deploy)

1. Click the **Deploy to Cloudflare Workers** button above.
2. Follow the prompts to connect your GitHub and deploy to Cloudflare.
3. Apply database migrations to your live instance:
   ```bash
   npx wrangler d1 migrations apply record-manager-db --remote
   ```
4. Open your deployed Worker URL.
5. Complete the **Initial Setup** by providing your:
   * **Cloudflare API Token** (with DNS:Edit and Zone:Read permissions)
   * **Google OAuth Credentials** (Client ID & Client Secret)

> [!TIP]
> **Automated Deployments:** To sync live deployments with your `git push` actions, go to your **Cloudflare Dashboard** > **Workers** > `record-manager` > **Settings** > **Git Integration** and link this GitHub repository.

---

## ✨ Features

* **Zone Sync:** Fast, real-time import of multiple Cloudflare DNS zones.
* **Modern minimalist UI:** A custom light-themed SaaS dashboard featuring geometric display typography.
* **Granular Domain RBAC:** Delegate fine-grained domain-wide access clearances:
  * `Read`: Read-only view of all zone records.
  * `Add Only`: Authorized to create new records.
  * `Edit Own`: Create records and manage (edit/delete) **only** the records they created.
  * `Edit Any`: Modify any record within the zone, but restricted from deleting.
  * `Delete Any`: Full record management capabilities.
* **Record-Level Access Control (RLAC):** Delegate control of a **single record** (e.g., `api.example.com`) to an external engineer or third party. The user will be isolated and only see/manage that specific record.
* **Click-to-Copy Identifiers:** One-click copying of record IDs directly from the domain dashboard for fast permissions assignment.
* **Audit Logs:** Full ledger tracking every deployment, record creation, update, and deletion.
* **Blacklist Protection:** Secure crucial namespaces (e.g. `*.internal.com`) to restrict write operations to system owners.

---

## 🛠 Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run database migrations on your local SQLite instance:
   ```bash
   npx wrangler d1 migrations apply record-manager-db --local
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

---

## 🔒 Security & Identity

* **Google OAuth:** Access is strictly authenticated through Google OAuth.
* **Auto-Provisioning:** The first user to log in after running the setup screen is automatically assigned the global **Owner** role.
* **Admin Role:** Administrative users can view audit logs and manage non-owner users.
