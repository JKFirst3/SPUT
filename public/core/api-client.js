export class ApiClient {
  async request(url, options = {}) {
    const response = await fetch(url, options);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new Error("Der laufende SPUT-Server ist nicht aktuell. Bitte SPUT einmal beenden und neu starten.");
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Anfrage fehlgeschlagen (${response.status}).`);
    return payload;
  }

  get(url) { return this.request(url); }
  post(url, body) {
    return this.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
}
