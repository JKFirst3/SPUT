export class UpdateService {
  constructor({ currentVersion, repository }) {
    this.currentVersion = currentVersion;
    this.repository = repository;
  }

  async check() {
    try {
      const response = await fetch(`https://api.github.com/repos/${this.repository}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "SPUT-Update-Checker" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 404) return { available: false, currentVersion: this.currentVersion, message: "Für dieses Repository ist noch keine öffentliche Version veröffentlicht." };
      if (!response.ok) throw new Error(`GitHub antwortet mit Status ${response.status}`);
      const release = await response.json();
      const latest = String(release.tag_name ?? "").replace(/^v/, "");
      return { available: latest && latest !== this.currentVersion, currentVersion: this.currentVersion, latestVersion: latest, url: release.html_url, message: latest === this.currentVersion ? "SPUT ist aktuell." : `Version ${latest} ist verfügbar.` };
    } catch (error) {
      return { available: false, currentVersion: this.currentVersion, message: `Update-Prüfung nicht möglich: ${error.message}` };
    }
  }
}
