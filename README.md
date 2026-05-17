# 🛠 Record Manager

A simple, easy-to-use DNS record manager for Cloudflare, built with Hono and D1.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/simon-msdos/record-manager)

## 🚀 Quick Start (One-Click Deploy)

1.  Click the **Deploy to Cloudflare Workers** button above.
2.  Follow the prompts to connect your GitHub and deploy to Cloudflare.
3.  Once deployed, if you see an "Internal Server Error", you need to apply the database migrations. Run this command in your terminal:
    ```bash
    npx wrangler d1 migrations apply record-manager-db --remote
    ```
4.  Open your deployed Worker URL.
5.  Complete the **Initial Setup** by providing your:
    *   Cloudflare API Token (with DNS permissions)
    *   Google OAuth Client ID & Secret

## ✨ Features

*   **Zone Sync:** Easily import and manage multiple Cloudflare zones.
*   **Simple Editor:** A clean interface for A, CNAME, TXT, and MX records.
*   **Multi-User:** Invite teammates with specific permission levels (Read, Add, Edit, Delete).
*   **Audit Logs:** Track every change made to your DNS records.
*   **Blacklist:** Protect sensitive records from being modified by non-owners.

## 🛠 Local Development

1.  Install dependencies: `npm install`
2.  Run migrations locally: `npx wrangler d1 migrations apply record-manager-db --local`
3.  Start dev server: `npm run dev`

## 🔒 Security

This app uses Google OAuth for authentication. The first user to log in after setup is automatically assigned the **Owner** role.
