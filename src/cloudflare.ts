export class CloudflareClient {
  private token: string;
  private baseUrl = 'https://api.cloudflare.com/client/v4';

  constructor(token: string) {
    this.token = token;
  }

  private async request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(error.errors?.[0]?.message || 'Cloudflare API error');
    }

    return (await response.json() as any).result;
  }

  async listZones() {
    let allZones: any[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await fetch(`${this.baseUrl}/zones?page=${page}&per_page=50`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json() as any;
        throw new Error(error.errors?.[0]?.message || 'Cloudflare API error');
      }

      const data = await response.json() as any;
      allZones = allZones.concat(data.result);
      
      const info = data.result_info;
      if (info) {
        totalPages = Math.ceil(info.total_count / info.per_page);
      }
      page++;
    } while (page <= totalPages);

    return allZones;
  }

  async getZone(zoneId: string) {
    return this.request(`/zones/${zoneId}`);
  }

  async listRecords(zoneId: string) {
    return this.request(`/zones/${zoneId}/dns_records`);
  }

  async createRecord(zoneId: string, record: { type: string; name: string; content: string; ttl?: number; proxied?: boolean }) {
    return this.request(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record),
    });
  }

  async updateRecord(zoneId: string, recordId: string, record: { type: string; name: string; content: string; ttl?: number; proxied?: boolean }) {
    return this.request(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
  }

  async deleteRecord(zoneId: string, recordId: string) {
    return this.request(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'DELETE',
    });
  }
}
